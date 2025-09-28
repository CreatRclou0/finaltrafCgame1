import { CONFIG } from './config.js';
import { traj_precalc } from './paths.js';

export class Intersection {
    getPathEntryPoint(direction) {
        // Entry point for trajectory calculation - should be at intersection edge, centered in lane
        const halfRoad = this.roadWidth / 2; // 30px
        const laneCenter = this.laneWidth * 0.5; // 7.5px (inner lane center)
        
        switch (direction) {
            case CONFIG.DIRECTIONS.NORTH:
                return { x: this.centerX - laneCenter, y: this.centerY - halfRoad };
            case CONFIG.DIRECTIONS.EAST:
                return { x: this.centerX + halfRoad, y: this.centerY - laneCenter };
            case CONFIG.DIRECTIONS.SOUTH:
                return { x: this.centerX + laneCenter, y: this.centerY + halfRoad };
            case CONFIG.DIRECTIONS.WEST:
                return { x: this.centerX - halfRoad, y: this.centerY + laneCenter };
            default:
                return { x: this.centerX, y: this.centerY };
        }
    }

    constructor(centerX, centerY) {
        this.centerX = centerX;
        this.centerY = centerY;
        this.size = CONFIG.INTERSECTION_SIZE;
        this.roadWidth = CONFIG.ROAD_WIDTH;
        this.laneWidth = CONFIG.LANE_WIDTH;
        
        this.calculatePositions();
    }

    initialize() {
        this.calculatePositions();
    }

    calculatePositions() {
        const halfSize = this.size / 2;
        const halfRoad = this.roadWidth / 2;
        const laneOffset = this.laneWidth / 2;
        
        // Stop line positions (closer to intersection for better traffic flow)
        const stopLineOffset = halfSize - 10;
        this.stopLines = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x1: this.centerX - halfRoad,
                y1: this.centerY - stopLineOffset,
                x2: this.centerX + halfRoad,
                y2: this.centerY - stopLineOffset
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x1: this.centerX + stopLineOffset,
                y1: this.centerY - halfRoad,
                x2: this.centerX + stopLineOffset,
                y2: this.centerY + halfRoad
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x1: this.centerX - halfRoad,
                y1: this.centerY + stopLineOffset,
                x2: this.centerX + halfRoad,
                y2: this.centerY + stopLineOffset
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x1: this.centerX - stopLineOffset,
                y1: this.centerY - halfRoad,
                x2: this.centerX - stopLineOffset,
                y2: this.centerY + halfRoad
            }
        };

        // Traffic light positions - moved much further off the road
        this.lightPositions = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x: this.centerX - 50,  // Much further left
                y: this.centerY - halfSize - 80  // Much further up
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x: this.centerX + halfSize + 50,  // Much further right
                y: this.centerY - 50  // Much further up
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x: this.centerX + 50,  // Much further right
                y: this.centerY + halfSize + 50  // Much further down
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x: this.centerX - halfSize - 80,  // Much further left
                y: this.centerY + 50  // Much further down
            }
        };

        // Car spawn points - simplified to 2 lanes per direction
        this.spawnPoints = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x: this.centerX - laneOffset,
                y: 0
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x: CONFIG.CANVAS_WIDTH,
                y: this.centerY - laneOffset
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x: this.centerX + laneOffset,
                y: CONFIG.CANVAS_HEIGHT
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x: 0,
                y: this.centerY + laneOffset
            }
        };
        
        // Update spawn points to support both lanes
        this.updateSpawnPointsForLanes();

        // Exit points - positioned in lane centers for straight-through traffic
        const laneCenter = this.laneWidth * 0.5;
        this.exitPoints = {
            [CONFIG.DIRECTIONS.NORTH]: {
                x: this.centerX + laneCenter,
                y: 0
            },
            [CONFIG.DIRECTIONS.EAST]: {
                x: CONFIG.CANVAS_WIDTH,
                y: this.centerY + laneCenter
            },
            [CONFIG.DIRECTIONS.SOUTH]: {
                x: this.centerX - laneCenter,
                y: CONFIG.CANVAS_HEIGHT
            },
            [CONFIG.DIRECTIONS.WEST]: {
                x: 0,
                y: this.centerY - laneCenter
            }
        };
    }

    updateSpawnPointsForLanes() {
        // Simplified to 2 lanes per direction
        // Lane 0: rightmost lane (right turns only)
        // Lane 1: second rightmost lane (left turns and straight)
        
        const lane0Offset = this.laneWidth * 0.25; // 3.75px from center
        const lane1Offset = this.laneWidth * 0.75; // 11.25px from center
        
        this.spawnPointsByLane = {
            [CONFIG.DIRECTIONS.NORTH]: [
                // Lane 0: rightmost lane (for right turns to west)
                { x: this.centerX - lane0Offset, y: 0 },
                // Lane 1: second rightmost lane (for left turns to east and straight to south)
                { x: this.centerX - lane1Offset, y: 0 }
            ],
            [CONFIG.DIRECTIONS.EAST]: [
                // Lane 0: rightmost lane (for right turns to north)
                { x: CONFIG.CANVAS_WIDTH, y: this.centerY - lane0Offset },
                // Lane 1: second rightmost lane (for left turns to south and straight to west)
                { x: CONFIG.CANVAS_WIDTH, y: this.centerY - lane1Offset }
            ],
            [CONFIG.DIRECTIONS.SOUTH]: [
                // Lane 0: rightmost lane (for right turns to east)
                { x: this.centerX + lane0Offset, y: CONFIG.CANVAS_HEIGHT },
                // Lane 1: second rightmost lane (for left turns to west and straight to north)
                { x: this.centerX + lane1Offset, y: CONFIG.CANVAS_HEIGHT }
            ],
            [CONFIG.DIRECTIONS.WEST]: [
                // Lane 0: rightmost lane (for right turns to south)
                { x: 0, y: this.centerY + lane0Offset },
                // Lane 1: second rightmost lane (for left turns to north and straight to east)
                { x: 0, y: this.centerY + lane1Offset }
            ]
        };
    }

    getSpawnPointForLane(direction, lane) {
        if (this.spawnPointsByLane[direction] && this.spawnPointsByLane[direction][lane]) {
            return this.spawnPointsByLane[direction][lane];
        }
        return this.spawnPoints[direction];
    }

    render(ctx) {
        this.drawRoads(ctx);
        this.drawIntersection(ctx);
        this.drawLaneMarkings(ctx);
        this.drawStopLines(ctx);
    }

    drawRoads(ctx) {
        const halfRoad = this.roadWidth / 2;
        
        ctx.fillStyle = '#444444';
        
        // Vertical road (North-South)
        ctx.fillRect(
            this.centerX - halfRoad,
            0,
            this.roadWidth,
            CONFIG.CANVAS_HEIGHT
        );
        
        // Horizontal road (East-West)
        ctx.fillRect(
            0,
            this.centerY - halfRoad,
            CONFIG.CANVAS_WIDTH,
            this.roadWidth
        );
    }

    drawIntersection(ctx) {
        const halfRoad = this.roadWidth / 2;
        const curveRadius = halfRoad;

        ctx.fillStyle = '#666666';
        ctx.beginPath();

        // Start top middle going clockwise
        ctx.moveTo(this.centerX - halfRoad, this.centerY - halfRoad - curveRadius);

        // Top left inward curve
        ctx.quadraticCurveTo(
            this.centerX - halfRoad, this.centerY - halfRoad,
            this.centerX - halfRoad - curveRadius, this.centerY - halfRoad
        );

        // Left top to left bottom
        ctx.lineTo(this.centerX - halfRoad - curveRadius, this.centerY + halfRoad);

        // Bottom left inward curve
        ctx.quadraticCurveTo(
            this.centerX - halfRoad, this.centerY + halfRoad,
            this.centerX - halfRoad, this.centerY + halfRoad + curveRadius
        );

        // Bottom middle to bottom right
        ctx.lineTo(this.centerX + halfRoad, this.centerY + halfRoad + curveRadius);

        // Bottom right inward curve
        ctx.quadraticCurveTo(
            this.centerX + halfRoad, this.centerY + halfRoad,
            this.centerX + halfRoad + curveRadius, this.centerY + halfRoad
        );

        // Right bottom to right top
        ctx.lineTo(this.centerX + halfRoad + curveRadius, this.centerY - halfRoad);

        // Top right inward curve
        ctx.quadraticCurveTo(
            this.centerX + halfRoad, this.centerY - halfRoad,
            this.centerX + halfRoad, this.centerY - halfRoad - curveRadius
        );

        // Back to start
        ctx.closePath();
        ctx.fill();

        // Restore normal drawing mode for anything after
        ctx.globalCompositeOperation = 'source-over';
    }

    drawLaneMarkings(ctx) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);

        const halfRoad = this.roadWidth / 2;
        
        // Vertical lane markings (North-South road)
        ctx.beginPath();
        // Center divider
        ctx.moveTo(this.centerX, 0);
        ctx.lineTo(this.centerX, this.centerY - halfRoad);
        ctx.moveTo(this.centerX, this.centerY + halfRoad);
        ctx.lineTo(this.centerX, CONFIG.CANVAS_HEIGHT);
        
        // Lane divider for left side
        const leftDivider = this.centerX - this.laneWidth / 2;
        ctx.moveTo(leftDivider, 0);
        ctx.lineTo(leftDivider, this.centerY - halfRoad);
        ctx.moveTo(leftDivider, this.centerY + halfRoad);
        ctx.lineTo(leftDivider, CONFIG.CANVAS_HEIGHT);
        
        // Lane divider for right side
        const rightDivider = this.centerX + this.laneWidth / 2;
        ctx.moveTo(rightDivider, 0);
        ctx.lineTo(rightDivider, this.centerY - halfRoad);
        ctx.moveTo(rightDivider, this.centerY + halfRoad);
        ctx.lineTo(rightDivider, CONFIG.CANVAS_HEIGHT);
        ctx.stroke();
        
        // Horizontal lane markings (East-West road)
        ctx.beginPath();
        // Center divider
        ctx.moveTo(0, this.centerY);
        ctx.lineTo(this.centerX - halfRoad, this.centerY);
        ctx.moveTo(this.centerX + halfRoad, this.centerY);
        ctx.lineTo(CONFIG.CANVAS_WIDTH, this.centerY);
        
        // Lane divider for top side
        const topDivider = this.centerY - this.laneWidth / 2;
        ctx.moveTo(0, topDivider);
        ctx.lineTo(this.centerX - halfRoad, topDivider);
        ctx.moveTo(this.centerX + halfRoad, topDivider);
        ctx.lineTo(CONFIG.CANVAS_WIDTH, topDivider);
        
        // Lane divider for bottom side
        const bottomDivider = this.centerY + this.laneWidth / 2;
        ctx.moveTo(0, bottomDivider);
        ctx.lineTo(this.centerX - halfRoad, bottomDivider);
        ctx.moveTo(this.centerX + halfRoad, bottomDivider);
        ctx.lineTo(CONFIG.CANVAS_WIDTH, bottomDivider);
        ctx.stroke();

        ctx.setLineDash([]);
    }

    drawStopLines(ctx) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        
        Object.values(this.stopLines).forEach(line => {
            ctx.beginPath();
            ctx.moveTo(line.x1, line.y1);
            ctx.lineTo(line.x2, line.y2);
            ctx.stroke();
        });
    }

    // Helper methods for car navigation
    getStopLinePosition(direction) {
        return this.stopLines[direction];
    }

    getSpawnPoint(direction) {
        const offset = 300;
        switch (direction) {
            case 'north': return { x: this.centerX, y: this.centerY - offset };
            case 'south': return { x: this.centerX, y: this.centerY + offset };
            case 'east':  return { x: this.centerX + offset, y: this.centerY };
            case 'west':  return { x: this.centerX - offset, y: this.centerY };
            default: return undefined;
        }
    }

    getExitPoint(direction) {
        const offset = 300;
        switch (direction) {
            case 'north': return { x: this.centerX, y: this.centerY - offset };
            case 'south': return { x: this.centerX, y: this.centerY + offset };
            case 'east':  return { x: this.centerX + offset, y: this.centerY };
            case 'west':  return { x: this.centerX - offset, y: this.centerY };
            default: return undefined;
        }
    }

    getLightPosition(direction) {
        if (!direction || typeof direction !== 'string') {
            console.warn("Invalid direction for getLightPosition:", direction);
            return undefined;
        }
        return this.lightPositions[direction];
    }

    // Check if a point is within the intersection
    isInIntersection(x, y) {
        const halfRoad = this.roadWidth / 2;
        return (
            x >= this.centerX - halfRoad &&
            x <= this.centerX + halfRoad &&
            y >= this.centerY - halfRoad &&
            y <= this.centerY + halfRoad
        );
    }

    // Get proper exit point based on turn type to ensure correct lane usage
    getProperExitPoint(fromDirection, toDirection, turnType) {
        return this.exitPoints[toDirection];
    }

    // Get turning path for straight-line turns (no curves)
    getTurningPath(fromDirection, toDirection, turnType) {
        return [this.getPathEntryPoint(fromDirection), this.exitPoints[toDirection]];
    }

    // Method to provide car manager reference to cars
    setCarManager(carManager) {
        this.carManager = carManager;
    }
    
    getAllCars() {
        return this.carManager ? this.carManager.getCars() : [];
    }

    // Calculate trajectory for a vehicle based on turn type
    calculateTrajectory(fromDirection, toDirection, turnType) {
        try {
            const entry = this.getPathEntryPoint(fromDirection);
            const exit = this.getExitPointForTurn(fromDirection, turnType);
            
            if (!entry || !exit) {
                console.error("Invalid entry/exit points for trajectory", {fromDirection, turnType, entry, exit});
                return null;
            }
            
            let du = []; // Segment lengths
            let curv = []; // Curvatures
            let phi0 = this.getInitialHeading(fromDirection);
            
            if (turnType === CONFIG.TURN_TYPES.LEFT) {
                // Left turn: straight -> curve -> straight
                const straightDist = 12;
                const turnRadius = 14;
                const turnArcLength = (Math.PI / 2) * turnRadius;
                
                du = [straightDist, turnArcLength, straightDist];
                curv = [0, 1/turnRadius, 0]; // Positive curvature = left turn
                
            } else if (turnType === CONFIG.TURN_TYPES.RIGHT) {
                // Right turn: straight -> curve -> straight  
                const straightDist = 16;
                const turnRadius = 18;
                const turnArcLength = (Math.PI / 2) * turnRadius;
                
                du = [straightDist, turnArcLength, straightDist];
                curv = [0, -1/turnRadius, 0]; // Negative curvature = right turn
                
            } else {
                // Straight through
                const totalDist = Math.sqrt((exit.x - entry.x)**2 + (exit.y - entry.y)**2);
                du = [totalDist];
                curv = [0];
            }
            
            const trajectory = traj_precalc(entry.x, entry.y, phi0, du, curv);
            console.log("Created trajectory for", fromDirection, "->", turnType, {entry, exit, du, curv});
            return trajectory;
            
        } catch (error) {
            console.error("Error in calculateTrajectory:", error);
            return null;
        }
    }

    // Helper method to get initial heading based on direction
    getInitialHeading(direction) {
        switch (direction) {
            case CONFIG.DIRECTIONS.NORTH: return Math.PI / 2;   // Facing south
            case CONFIG.DIRECTIONS.EAST: return Math.PI;        // Facing west  
            case CONFIG.DIRECTIONS.SOUTH: return -Math.PI / 2;  // Facing north
            case CONFIG.DIRECTIONS.WEST: return 0;              // Facing east
            default: return 0;
        }
    }

    // Helper method to get exit point based on turn type
    getExitPointForTurn(fromDirection, turnType) {
        const laneCenter = this.laneWidth * 0.5;
        
        switch (fromDirection) {
            case CONFIG.DIRECTIONS.NORTH:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        return { x: this.centerX + laneCenter, y: CONFIG.CANVAS_HEIGHT };
                    case CONFIG.TURN_TYPES.LEFT:
                        return { x: CONFIG.CANVAS_WIDTH, y: this.centerY + laneCenter };
                    case CONFIG.TURN_TYPES.RIGHT:
                        return { x: 0, y: this.centerY - laneCenter };
                }
                break;
                
            case CONFIG.DIRECTIONS.SOUTH:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        return { x: this.centerX - laneCenter, y: 0 };
                    case CONFIG.TURN_TYPES.LEFT:
                        return { x: 0, y: this.centerY - laneCenter };
                    case CONFIG.TURN_TYPES.RIGHT:
                        return { x: CONFIG.CANVAS_WIDTH, y: this.centerY + laneCenter };
                }
                break;
                
            case CONFIG.DIRECTIONS.EAST:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        return { x: 0, y: this.centerY + laneCenter };
                    case CONFIG.TURN_TYPES.LEFT:
                        return { x: this.centerX - laneCenter, y: 0 };
                    case CONFIG.TURN_TYPES.RIGHT:
                        return { x: this.centerX + laneCenter, y: CONFIG.CANVAS_HEIGHT };
                }
                break;
                
            case CONFIG.DIRECTIONS.WEST:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        return { x: CONFIG.CANVAS_WIDTH, y: this.centerY - laneCenter };
                    case CONFIG.TURN_TYPES.LEFT:
                        return { x: this.centerX + laneCenter, y: CONFIG.CANVAS_HEIGHT };
                    case CONFIG.TURN_TYPES.RIGHT:
                        return { x: this.centerX - laneCenter, y: 0 };
                }
                break;
        }
        
        // Fallback
        return this.exitPoints[fromDirection];
    }
}