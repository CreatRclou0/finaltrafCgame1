// paths.js
// Trajectory calculator for vehicles in the traffic simulation
// Simplified version without lane changing logic

/**
 * Pre-calculates stitching points for a trajectory
 * @param {number} x0 - Starting x position (meters)
 * @param {number} y0 - Starting y position (meters)
 * @param {number} phi0 - Initial heading (radians)
 * @param {number[]} du - Array of segment lengths (meters)
 * @param {number[]} curv - Array of curvatures (1/radius)
 * @returns {Object} Trajectory specification object
 */
function traj_precalc(x0, y0, phi0, du, curv) {
    const up = [0]; // Arc length at stitching points
    const phip = [phi0];
    const xp = [x0];
    const yp = [y0];
    const xc = [];
    const yc = [];

    for (let i = 0; i < du.length; i++) {
        up[i + 1] = up[i] + du[i];
        phip[i + 1] = phip[i] + curv[i] * du[i];
        const straightSegm = Math.abs(curv[i]) < 1e-6;
        const r = straightSegm ? 1e6 : 1 / curv[i];
        if (straightSegm) {
            xp[i + 1] = xp[i] + du[i] * Math.cos(phip[i]);
            yp[i + 1] = yp[i] + du[i] * Math.sin(phip[i]);
            xc[i] = 1e6;
            yc[i] = 1e6;
        } else {
            xc[i] = xp[i] - r * Math.sin(phip[i]);
            yc[i] = yp[i] + r * Math.cos(phip[i]);
            xp[i + 1] = xc[i] + r * Math.sin(phip[i + 1]);
            yp[i + 1] = yc[i] - r * Math.cos(phip[i + 1]);
        }
    }
    return {
        u: up,
        phi: phip,
        x: xp,
        y: yp,
        xCenter: xc,
        yCenter: yc
    };
}

/**
 * Returns [x, y] at distance u along a trajectory
 * @param {number} u - Distance along path
 * @param {Object} trajP - Trajectory spec from traj_precalc
 * @returns {number[]} [x, y] coordinates
 */
function trajFromSpec(u, trajP) {
    let iSegm = 0;
    while ((u > trajP.u[iSegm + 1]) && (iSegm + 1 < trajP.xCenter.length)) iSegm++;
    const curv = (trajP.phi[iSegm + 1] - trajP.phi[iSegm]) / (trajP.u[iSegm + 1] - trajP.u[iSegm]);
    const straightSegm = Math.abs(curv) < 1e-6;
    const r = straightSegm ? 1e6 : 1 / curv;
    const x = straightSegm
        ? trajP.x[iSegm] + (u - trajP.u[iSegm]) * Math.cos(trajP.phi[iSegm])
        : trajP.xCenter[iSegm] + r * Math.sin(trajP.phi[iSegm] + curv * (u - trajP.u[iSegm]));
    const y = straightSegm
        ? trajP.y[iSegm] + (u - trajP.u[iSegm]) * Math.sin(trajP.phi[iSegm])
        : trajP.yCenter[iSegm] - r * Math.cos(trajP.phi[iSegm] + curv * (u - trajP.u[iSegm]));
    return [x, y];
}

// Constants for intersection geometry
const INTERSECTION_LANE_WIDTH = 15; // meters (matches CONFIG.LANE_WIDTH)
const INTERSECTION_RADIUS = 30; // meters (for curved turns)
const STRAIGHT_SEGMENT = 40; // meters

// Export functions for use in simulation
export {
    traj_precalc,
    trajFromSpec,
    INTERSECTION_LANE_WIDTH,
    INTERSECTION_RADIUS,
    STRAIGHT_SEGMENT
};