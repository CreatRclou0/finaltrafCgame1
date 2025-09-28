import { CONFIG } from "./config.js";
import { utils } from './utils.js';
import { traj_precalc, trajFromSpec, update_v_dvdt_optical, INTERSECTION_LANE_WIDTH, INTERSECTION_RADIUS } from './paths.js';

export class Car {
    constructor({ id, direction, intersection, route = null, lane = 0 }) {
        this.id = id;
        this.fromDirection = direction;
        this.intersection = intersection;
        this.route = route || [direction, 'intersection', this.calculateToDirection()];
        this.lane = lane; // 0 = lane for one direction, 1 = lane for opposite direction
        this.lateralPosition = 0; // 0 = center of lane
        this.turnType = this.calculateTurnType();
        this.toDirection = this.route[2];

        
        // Position and movement
        const spawnPoint = intersection.getSpawnPointForLane(direction, lane);
        this.x = spawnPoint.x;
        this.y = spawnPoint.y;
        this.angle = this.getInitialAngle();

        // Properties
        this.speed = 0;
        this.maxSpeed = CONFIG.DEFAULT_SETTINGS.CAR_SPEED;
        this.width = CONFIG.CAR_WIDTH;
        this.height = CONFIG.CAR_HEIGHT;
        this.color = CONFIG.CAR_COLORS[Math.floor(Math.random() * CONFIG.CAR_COLORS.length)];

        // State
        this.state = 'approaching'; // approaching, waiting, crossing, turning, exiting, completed
        this.waitStartTime = null;
        this.totalWaitTime = 0;
        this.isInIntersection = false;
        this.pathProgress = 0;
        this.turnStartTime = null;

        // Path and trajectory properties
        this.trajectorySpec = null;
        this.trajectoryDistance = 0;
        this.isRegularVeh = true; // For path calculations
        
        // Lane change properties
        this.laneOld = lane;
        this.fracLaneOptical = 0; // Fractional position during lane change (0=start, 1=end)
        this.v = 0; // Lateral position for lane changes
        this.dvdt = 0; // Lateral velocity during lane change
        this.dt_LC = 4; // Lane change duration in seconds
        this.dt_afterLC = 0; // Time since lane change started

        // Calculate target position for movement
        this.calculateTargetPosition();
    }

    calculateTurnType() {
        // STRICT LANE DISCIPLINE: Turn type determined by lane, not random
        // Lane 0 (inner lane, closer to opposite traffic) = LEFT TURNS ONLY
        // Lane 1 (outer lane, further from opposite traffic) = RIGHT TURNS ONLY
        // Both lanes can go STRAIGHT
        
        if (this.lane === 0) {
            // Inner lane: 70% straight, 30% left turn
            const rand = Math.random();
            if (rand < 0.7) return CONFIG.TURN_TYPES.STRAIGHT;
            else return CONFIG.TURN_TYPES.LEFT;
        } else if (this.lane === 1) {
            // Outer lane: 70% straight, 30% right turn  
            const rand = Math.random();
            if (rand < 0.7) return CONFIG.TURN_TYPES.STRAIGHT;
            else return CONFIG.TURN_TYPES.RIGHT;
        }
        
        // Fallback (should not happen)
        return CONFIG.TURN_TYPES.STRAIGHT;
    }

    prepareForTurn() {
        // Tactical lane change before intersection
        if (this.turnType === CONFIG.TURN_TYPES.LEFT) this.lane = 0;
        else if (this.turnType === CONFIG.TURN_TYPES.RIGHT) this.lane = 1;
        // For straight, stay in current lane
    }

    updateApproaching(dt, lightStates) {
        this.prepareForTurn();
        // ...existing code...
        // ...existing code...
    }

    updateCrossing(dt) {
        // Accelerate through intersection
        this.speed = Math.min(this.maxSpeed * 1.2, this.speed + 40 * dt);
        // Move along trajectory
        if (this.turnType === CONFIG.TURN_TYPES.LEFT || this.turnType === CONFIG.TURN_TYPES.RIGHT) {
            this.followTurnTrajectory(dt);
        } else {
            // Straight
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
        }
        // Check if we've exited the intersection
        if (!this.isInIntersection && this.pathProgress > 0) {
            this.state = 'exiting';
        }
        this.pathProgress += dt;
    }

    followTurnTrajectory(dt) {
        if (!this.trajectorySpec) {
            console.warn("No trajectory spec for car", this.id, "- initializing");
            this.initializeTrajectory();
            return;
        }
        
        try {
            // Update trajectory distance based on speed
            this.trajectoryDistance += this.speed * dt;
            
            // Get current position from trajectory
            const position = trajFromSpec(this.trajectoryDistance, this.trajectorySpec);
            if (!position || position.length < 2) {
                console.warn("Invalid position from trajectory for car", this.id, "- using emergency fallback");
                // Emergency fallback - keep car moving in current direction
                this.x += Math.cos(this.angle) * this.speed * dt;
                this.y += Math.sin(this.angle) * this.speed * dt;
                return;
            }
            
            // Update car position
            this.x = position[0];
            this.y = position[1];
            
            // Add position validation to prevent cars from getting invalid positions
            if (isNaN(this.x) || isNaN(this.y)) {
                console.error("Invalid position for car", this.id, "- using fallback position");
                // Reset to a safe position near intersection center
                this.x = this.intersection.centerX;
                this.y = this.intersection.centerY;
            }
            
            // Update heading based on trajectory direction (look ahead for smooth rotation)
            const lookAhead = Math.max(2, this.speed * 0.1); // Dynamic look-ahead
            const nextPosition = trajFromSpec(this.trajectoryDistance + lookAhead, this.trajectorySpec);
            
            if (nextPosition && nextPosition.length >= 2) {
                const dx = nextPosition[0] - this.x;
                const dy = nextPosition[1] - this.y;
                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) { // Only update if there's significant movement
                    this.angle = Math.atan2(dy, dx);
                }
            }
            
            console.log("Car", this.id, "trajectory position:", this.x.toFixed(1), this.y.toFixed(1), "angle:", (this.angle * 180/Math.PI).toFixed(1));
        } catch (error) {
            console.error("Error in followTurnTrajectory for car", this.id, error);
            throw error; // Re-throw so updateCrossing can handle fallback
        }
    }

    initializeTrajectory() {
        try {
            // Use intersection's trajectory calculation
            this.trajectorySpec = this.intersection.calculateTrajectory(
                this.fromDirection, 
                this.toDirection, 
                this.turnType
            );
            
            if (!this.trajectorySpec) {
                console.error("Failed to create trajectory for car", this.id, {
                    from: this.fromDirection,
                    to: this.toDirection,
                    turnType: this.turnType
                });
                // Create a simple fallback trajectory
                this.createFallbackTrajectory();
            } else {
                console.log("Initialized trajectory for car", this.id, "turn type:", this.turnType);
            }
        } catch (error) {
            console.error("Error creating trajectory for car", this.id, error);
            this.createFallbackTrajectory();
        }
    }

    doSimpleTurn(dt) {
        // Simple turning logic when trajectory system fails
        const centerX = this.intersection.centerX;
        const centerY = this.intersection.centerY;
        
        // Calculate turn rate based on speed and turn radius
        const turnRadius = 20; // Simple fixed radius for fallback turns
        const turnRate = this.speed / turnRadius; // radians per second
        
        // Apply turn rate based on turn type
        if (this.turnType === CONFIG.TURN_TYPES.LEFT) {
            this.angle += turnRate * dt; // Turn left (counter-clockwise)
        } else if (this.turnType === CONFIG.TURN_TYPES.RIGHT) {
            this.angle -= turnRate * dt; // Turn right (clockwise)
        }
        
        // Move forward
        this.x += Math.cos(this.angle) * this.speed * dt;
        this.y += Math.sin(this.angle) * this.speed * dt;
        
        console.log("Car", this.id, "simple turn - angle:", (this.angle * 180/Math.PI).toFixed(1), "position:", this.x.toFixed(1), this.y.toFixed(1));
    }

    createFallbackTrajectory() {
        // Create a simple straight-line trajectory as fallback
        const entry = this.intersection.getPathEntryPoint(this.fromDirection);
        const exit = this.intersection.exitPoints[this.toDirection];
        const distance = Math.sqrt((exit.x - entry.x)**2 + (exit.y - entry.y)**2);
        const heading = Math.atan2(exit.y - entry.y, exit.x - entry.x);
        
        this.trajectorySpec = traj_precalc(entry.x, entry.y, heading, [distance], [0]);
        console.warn("Using fallback trajectory for car", this.id);
    }

    calculateToDirection() {
        const directions = [CONFIG.DIRECTIONS.NORTH, CONFIG.DIRECTIONS.EAST, CONFIG.DIRECTIONS.SOUTH, CONFIG.DIRECTIONS.WEST];
        const currentIndex = directions.indexOf(this.fromDirection);
        
        switch (this.turnType) {
            case CONFIG.TURN_TYPES.STRAIGHT:
                return directions[(currentIndex + 2) % 4]; // Opposite direction
            case CONFIG.TURN_TYPES.RIGHT:
                return directions[(currentIndex + 3) % 4]; // Turn right (clockwise)
            case CONFIG.TURN_TYPES.LEFT:
                return directions[(currentIndex + 1) % 4]; // Turn left (counter-clockwise)
            default:
                return directions[(currentIndex + 2) % 4]; // Default to straight
        }
    }

    getInitialAngle() {
        switch (this.fromDirection) {
            case CONFIG.DIRECTIONS.NORTH: return Math.PI / 2; // Facing south (down)
            case CONFIG.DIRECTIONS.EAST: return Math.PI; // Facing west (left)
            case CONFIG.DIRECTIONS.SOUTH: return -Math.PI / 2; // Facing north (up)
            case CONFIG.DIRECTIONS.WEST: return 0; // Facing east (right)
            default: return 0;
        }
    }
calculateTargetPosition() {
    // Make sure intersection and fromDirection are valid
    if (this.intersection && typeof this.intersection.getExitPoint === 'function' && this.fromDirection) {
        const target = this.intersection.getExitPoint(this.fromDirection);
        if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
            console.warn("Target position is undefined or invalid for car", this.id);
            return;
        }
        this.targetX = target.x;
        this.targetY = target.y;
    } else {
        console.warn("intersection.getExitPoint is not a function or direction is missing");
    }
}

    update(deltaTime, lightStates) {
        const dt = deltaTime / 1000; // Convert to seconds

        // Safety check - if car has invalid position, reset to safe location
        if (isNaN(this.x) || isNaN(this.y)) {
            console.error("Car", this.id, "has invalid position, resetting to spawn point");
            const spawnPoint = this.intersection.getSpawnPointForLane(this.fromDirection, this.lane);
            this.x = spawnPoint.x;
            this.y = spawnPoint.y;
            this.state = 'approaching';
            this.speed = 0;
        }

        // Update lane change physics first
        this.updateLaneChangePhysics(dt);

        switch (this.state) {
            case 'approaching':
                this.updateApproaching(dt, lightStates);
                break;
            case 'waiting':
                this.updateWaiting(dt, lightStates);
                break;
            case 'crossing':
                this.updateCrossing(dt);
                break;
            case 'turning':
                console.log("Car", this.id, "in turning state - redirecting to crossing");
                this.updateTurning(dt);
                break;
            case 'exiting':
                this.updateExiting(dt);
                break;
            default:
                console.warn("Car", this.id, "in unknown state:", this.state, "- setting to exiting");
                this.state = 'exiting'; // Safety fallback for unknown states
        }

        // Movement is now handled in individual state update methods
        // Trajectory-based movement for crossing state, normal movement for other states
        if (this.speed > 0 && this.state !== 'crossing') {
            // Only use straight-line movement for non-crossing states
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
        }

        // Check if car is in intersection
        this.isInIntersection = this.intersection.isInIntersection(this.x, this.y);
    }

    updateLaneChangePhysics(dt) {
        // Update lane change progress
        if (this.dt_afterLC < this.dt_LC) {
            this.dt_afterLC += dt;
        }
        
        // Apply lane change physics using paths.js
        update_v_dvdt_optical(this);
        
        // Apply lateral offset to position during lane change
        if (this.dvdt !== 0) {
            const laneWidth = INTERSECTION_LANE_WIDTH;
            const lateralOffset = this.v * laneWidth;
            
            // Apply lateral offset perpendicular to movement direction
            const perpAngle = this.angle + Math.PI / 2;
            this.x += Math.cos(perpAngle) * lateralOffset;
            this.y += Math.sin(perpAngle) * lateralOffset;
        }
    }

    startLaneChange(targetLane) {
        if (this.lane !== targetLane) {
            this.laneOld = this.lane;
            this.lane = targetLane;
            this.fracLaneOptical = 0;
            this.dt_afterLC = 0;
            this.v = 0;
            this.dvdt = 0;
        }
    }

    updateApproaching(dt, lightStates) {
        this.prepareForTurn();
        
        const stopLine = this.intersection.getStopLinePosition(this.fromDirection);
        const distanceToStop = this.getDistanceToStopLine(stopLine);
        
        // Check for cars ahead to maintain spacing
        const carAhead = this.checkForCarAhead();
        const shouldStopForCar = carAhead && this.getDistanceToCarAhead(carAhead) < 25; // Reduced from 40 to 25
        
        // Improved stop line logic - cars should stop at or before the line when light is red
        if (distanceToStop <= 15 || shouldStopForCar) { // Increased from 5 to 15 for better stop line positioning
            if (lightStates[this.fromDirection] === CONFIG.LIGHT_STATES.RED || shouldStopForCar) {
                this.state = 'waiting';
                this.speed = 0;
                if (!shouldStopForCar && !this.waitStartTime) {
                    this.waitStartTime = Date.now();
                }
                return;
            }
        }
        
        // Continue approaching - but slow down if approaching red light
        if (lightStates[this.fromDirection] === CONFIG.LIGHT_STATES.RED && distanceToStop < 40) {
            // Slow down when approaching red light
            this.speed = Math.max(0, this.speed - 30 * dt); // Reduced deceleration
        } else {
            // Normal acceleration
            this.speed = Math.min(this.maxSpeed, this.speed + 30 * dt);
        }
        
        // Check if we've reached the intersection
        if (this.isInIntersection) {
            this.state = 'crossing';
        }
    }

    updateWaiting(dt, lightStates) {
        // Don't move while waiting
        this.speed = 0;
        
        if (this.waitStartTime) {
            this.totalWaitTime = Date.now() - this.waitStartTime;
        }
        
        // Check for car ahead before proceeding (only cars in SAME LANE)
        const carAhead = this.checkForCarAhead();
        const carTooClose = carAhead && this.getDistanceToCarAhead(carAhead) < 20; // Reduced from 35 to 20
        
        // More aggressive green light detection
        const lightColor = lightStates[this.fromDirection];
        const canProceed = lightColor === CONFIG.LIGHT_STATES.GREEN || 
                          lightColor === CONFIG.LIGHT_STATES.YELLOW ||
                          !lightColor;
        
        if (canProceed && !carTooClose) {
            console.log("Car", this.id, "proceeding from waiting - lane:", this.lane, "light:", lightColor);
            this.state = 'crossing';
            this.waitStartTime = null;
            this.speed = 10;
        }
        
        // Safety fallback - if car has been waiting too long, force it to proceed
        if (this.totalWaitTime > 15000) {
            console.warn("Car", this.id, "waited too long, forcing to proceed");
            this.state = 'crossing';
            this.waitStartTime = null;
            this.speed = 10;
        }
    }

    updateCrossing(dt) {
        // Accelerate through intersection
        this.speed = Math.min(this.maxSpeed * 1.2, this.speed + 40 * dt);
        
        // Use trajectory-based movement for turns, simple movement for straight
        if (this.turnType === CONFIG.TURN_TYPES.LEFT || this.turnType === CONFIG.TURN_TYPES.RIGHT) {
            // Initialize trajectory if needed
            if (!this.trajectorySpec) {
                console.log("Initializing trajectory for car", this.id, "turn type:", this.turnType);
                this.initializeTrajectory();
            }
            
            // Try trajectory-based movement first
            if (this.trajectorySpec) {
                try {
                    this.followTurnTrajectory(dt);
                } catch (error) {
                    console.warn("Trajectory failed for car", this.id, "using fallback:", error);
                    // Fallback to simple turning
                    this.doSimpleTurn(dt);
                }
            } else {
                // No trajectory available, use simple turning
                this.doSimpleTurn(dt);
            }
        } else {
            // Straight movement - no trajectory needed
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
        }
        
        // Simple exit check - if car is outside intersection bounds, it has exited
        if (!this.isInIntersection && this.pathProgress > 0.5) {
            console.log("Car", this.id, "exiting intersection - position:", this.x.toFixed(1), this.y.toFixed(1), "turnType:", this.turnType);
            this.state = 'exiting';
        }
        
        this.pathProgress += dt;
    }

    updateTurning(dt) {
        // NEW: Completely disable the old turning system that causes cars to disappear
        // Force the car back to crossing state
        this.state = 'crossing';
        this.speed = this.maxSpeed; // Make sure car keeps moving
        
        // Use the trajectory-based movement instead
        this.updateCrossing(dt);
    }

    getExitPosition(fromDirection, turnType, lane) {
        const cx = this.intersection.centerX;
        const cy = this.intersection.centerY;
        const roadWidth = CONFIG.ROAD_WIDTH;
        const laneWidth = CONFIG.LANE_WIDTH;
        const intersectionSize = CONFIG.INTERSECTION_SIZE;
        
        // Calculate lane offset from road center
        const laneOffset = (lane - 0.5) * laneWidth;
        const roadDistance = intersectionSize / 2 + 10; // Distance from center to road edge
        
        let exitDirection, x, y, heading;
        
        switch (fromDirection) {
            case CONFIG.DIRECTIONS.NORTH:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        exitDirection = CONFIG.DIRECTIONS.SOUTH;
                        x = cx + laneOffset;
                        y = cy + roadDistance;
                        heading = CONFIG.HEADINGS.SOUTH;
                        break;
                    case CONFIG.TURN_TYPES.LEFT:
                        exitDirection = CONFIG.DIRECTIONS.EAST;
                        x = cx + roadDistance;
                        y = cy + laneOffset;
                        heading = CONFIG.HEADINGS.EAST;
                        break;
                    case CONFIG.TURN_TYPES.RIGHT:
                        exitDirection = CONFIG.DIRECTIONS.WEST;
                        x = cx - roadDistance;
                        y = cy - laneOffset;
                        heading = CONFIG.HEADINGS.WEST;
                        break;
                }
                break;
                
            case CONFIG.DIRECTIONS.SOUTH:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        exitDirection = CONFIG.DIRECTIONS.NORTH;
                        x = cx - laneOffset;
                        y = cy - roadDistance;
                        heading = CONFIG.HEADINGS.NORTH;
                        break;
                    case CONFIG.TURN_TYPES.LEFT:
                        exitDirection = CONFIG.DIRECTIONS.WEST;
                        x = cx - roadDistance;
                        y = cy - laneOffset;
                        heading = CONFIG.HEADINGS.WEST;
                        break;
                    case CONFIG.TURN_TYPES.RIGHT:
                        exitDirection = CONFIG.DIRECTIONS.EAST;
                        x = cx + roadDistance;
                        y = cy + laneOffset;
                        heading = CONFIG.HEADINGS.EAST;
                        break;
                }
                break;
                
            case CONFIG.DIRECTIONS.EAST:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        exitDirection = CONFIG.DIRECTIONS.WEST;
                        x = cx - roadDistance;
                        y = cy + laneOffset;
                        heading = CONFIG.HEADINGS.WEST;
                        break;
                    case CONFIG.TURN_TYPES.LEFT:
                        exitDirection = CONFIG.DIRECTIONS.NORTH;
                        x = cx - laneOffset;
                        y = cy - roadDistance;
                        heading = CONFIG.HEADINGS.NORTH;
                        break;
                    case CONFIG.TURN_TYPES.RIGHT:
                        exitDirection = CONFIG.DIRECTIONS.SOUTH;
                        x = cx + laneOffset;
                        y = cy + roadDistance;
                        heading = CONFIG.HEADINGS.SOUTH;
                        break;
                }
                break;
                
            case CONFIG.DIRECTIONS.WEST:
                switch (turnType) {
                    case CONFIG.TURN_TYPES.STRAIGHT:
                        exitDirection = CONFIG.DIRECTIONS.EAST;
                        x = cx + roadDistance;
                        y = cy - laneOffset;
                        heading = CONFIG.HEADINGS.EAST;
                        break;
                    case CONFIG.TURN_TYPES.LEFT:
                        exitDirection = CONFIG.DIRECTIONS.SOUTH;
                        x = cx + laneOffset;
                        y = cy + roadDistance;
                        heading = CONFIG.HEADINGS.SOUTH;
                        break;
                    case CONFIG.TURN_TYPES.RIGHT:
                        exitDirection = CONFIG.DIRECTIONS.NORTH;
                        x = cx - laneOffset;
                        y = cy - roadDistance;
                        heading = CONFIG.HEADINGS.NORTH;
                        break;
                }
                break;
        }
        
        return { direction: exitDirection, x, y, heading };
    }

    degreesToRadians(degrees) {
        return (degrees * Math.PI) / 180;
    }

    getTargetExitAngle() {
        switch (this.toDirection) {
            case CONFIG.DIRECTIONS.NORTH: return -Math.PI / 2; // Facing up
            case CONFIG.DIRECTIONS.EAST: return 0; // Facing right
            case CONFIG.DIRECTIONS.SOUTH: return Math.PI / 2; // Facing down
            case CONFIG.DIRECTIONS.WEST: return Math.PI; // Facing left
            default: return this.angle;
        }
    }

    updateExiting(dt) {
        // Assign lane after turn
        if (this.turnType === 'left') this.lane = 0;
        else if (this.turnType === 'right') this.lane = 1;
        // For straight, keep lane
        this.lateralPosition = 0; // Center in lane

        // Update route to next segment (simulate route progression)
        if (this.route && this.route.length > 1) {
            this.route = this.route.slice(1);
        }

        // Continue moving at normal speed in the direction we're facing
        this.speed = this.maxSpeed;

        // Check if we've reached the edge of the canvas - more conservative boundaries
        let hasExited = false;

        // More conservative exit detection - larger boundaries to prevent premature removal
        hasExited = this.x < -100 || this.x > CONFIG.CANVAS_WIDTH + 100 || 
                   this.y < -100 || this.y > CONFIG.CANVAS_HEIGHT + 100;

        if (hasExited) {
            console.log("Car", this.id, "exiting canvas at position:", this.x.toFixed(1), this.y.toFixed(1));
            this.state = 'completed';
        }
    }

    getDistanceToStopLine(stopLine) {
        // Calculate distance from car front to stop line, considering direction
        switch (this.fromDirection) {
            case CONFIG.DIRECTIONS.NORTH:
                // Coming from north (top), going south - check distance to horizontal stop line
                return Math.max(0, stopLine.y1 - this.y - this.height/2);
            case CONFIG.DIRECTIONS.EAST:
                // Coming from east (right), going west - check distance to vertical stop line  
                return Math.max(0, this.x - this.width/2 - stopLine.x1);
            case CONFIG.DIRECTIONS.SOUTH:
                // Coming from south (bottom), going north - check distance to horizontal stop line
                return Math.max(0, this.y - this.height/2 - stopLine.y1);
            case CONFIG.DIRECTIONS.WEST:
                // Coming from west (left), going east - check distance to vertical stop line
                return Math.max(0, stopLine.x1 - this.x - this.width/2);
            default:
                return 0;
        }
    }

    render(ctx) {
        // Always render cars - multiple safeguards against disappearing cars
        
        // Validate position before rendering
        if (isNaN(this.x) || isNaN(this.y)) {
            console.error("Car", this.id, "has invalid position, skipping render");
            return;
        }
        
        ctx.save();
        // Move to car position and rotate
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        // Draw car body
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        // Draw car details
        ctx.fillStyle = '#333333';
        ctx.fillRect(-this.width / 2 + 2, -this.height / 2 + 2, this.width - 4, 3); // Windshield
        ctx.fillRect(-this.width / 2 + 2, this.height / 2 - 5, this.width - 4, 3); // Rear window
        ctx.restore();
    }

    // Getters for external systems
    isWaiting() {
        return this.state === 'waiting';
    }

    isCompleted() {
        return this.state === 'completed';
    }

    getWaitTime() {
        return this.totalWaitTime;
    }

    getDirection() {
        return this.fromDirection;
    }

    checkForCarAhead() {
        const allCars = this.intersection.carManager ? this.intersection.carManager.getCars() : [];
        
        let closestCar = null;
        let closestDistance = Infinity;
        
        for (const otherCar of allCars) {
            // Skip self
            if (otherCar.id === this.id) continue;
            
            // Skip cars from different directions
            if (otherCar.fromDirection !== this.fromDirection) continue;
            
            // MOST IMPORTANT: Only check cars in the EXACT SAME LANE
            if (otherCar.lane !== this.lane) continue; // This is the key fix!
            
            // Check if the other car is ahead of this car
            let isAhead = false;
            let distance = 0;
            
            switch (this.fromDirection) {
                case CONFIG.DIRECTIONS.NORTH:
                    isAhead = otherCar.y > this.y;
                    distance = otherCar.y - this.y - this.height;
                    break;
                case CONFIG.DIRECTIONS.EAST:
                    isAhead = otherCar.x < this.x;
                    distance = this.x - otherCar.x - this.width;
                    break;
                case CONFIG.DIRECTIONS.SOUTH:
                    isAhead = otherCar.y < this.y;
                    distance = this.y - otherCar.y - this.height;
                    break;
                case CONFIG.DIRECTIONS.WEST:
                    isAhead = otherCar.x > this.x;
                    distance = otherCar.x - this.x - this.width;
                    break;
            }
            
            if (isAhead && distance > 0 && distance < closestDistance) {
                closestDistance = distance;
                closestCar = otherCar;
            }
        }
        
        return closestCar;
    }

    getDistanceToCarAhead(carAhead) {
        if (!carAhead) return Infinity;
        
        switch (this.fromDirection) {
            case CONFIG.DIRECTIONS.NORTH:
                return carAhead.y - this.y - this.height;
            case CONFIG.DIRECTIONS.EAST:
                return this.x - carAhead.x - this.width;
            case CONFIG.DIRECTIONS.SOUTH:
                return this.y - carAhead.y - this.height;
            case CONFIG.DIRECTIONS.WEST:
                return carAhead.x - this.x - this.width;
            default:
                return Infinity;
        }
    }

    // ...existing code...
}

export class CarManager {
    constructor(intersection) {
        this.intersection = intersection;
        this.cars = [];
        this.nextCarId = 1;
        this.spawnTimer = 0;
        this.settings = { ...CONFIG.DEFAULT_SETTINGS };
        
        // Callbacks
        this.onCarCompleted = null;
        
        // Set reference in intersection for car-to-car communication
        this.intersection.carManager = this;
    }

    initialize(settings) {
        this.settings = { ...settings };
        this.cars = [];
        this.nextCarId = 1;
        this.spawnTimer = 0;
    }

    update(deltaTime, lightStates) {
        // Update spawn timer
        this.spawnTimer += deltaTime;
        
        // Spawn new cars
        const spawnInterval = (10000 / this.settings.CAR_SPAWN_RATE); // Convert rate to interval
        if (this.spawnTimer >= spawnInterval) {
            this.spawnCar();
            this.spawnTimer = 0;
        }

        // Update existing cars
        this.cars.forEach(car => {
            car.maxSpeed = this.settings.CAR_SPEED;
            
            // Safety check before updating each car
            if (!car || typeof car.update !== 'function') {
                console.error("Invalid car object found, skipping update");
                return;
            }
            
            car.update(deltaTime, lightStates);
        });

        // Remove completed cars and log what's happening
        const completedCars = this.cars.filter(car => car && car.isCompleted());
        
        // Only remove cars that have genuinely exited the canvas
        const validCompletedCars = completedCars.filter(car => {
            const hasExitedCanvas = car.x < -100 || car.x > CONFIG.CANVAS_WIDTH + 100 || 
                                   car.y < -100 || car.y > CONFIG.CANVAS_HEIGHT + 100;
            
            if (!hasExitedCanvas) {
                console.warn("Car", car.id, "marked as completed but hasn't exited canvas - keeping alive");
                car.state = 'exiting'; // Reset to exiting state
                return false;
            }
            return true;
        });
        
        validCompletedCars.forEach(car => {
            console.log("Removing completed car", car.id, "details:", {
                position: [car.x.toFixed(1), car.y.toFixed(1)],
                state: car.state,
                turnType: car.turnType,
                canvasBounds: {
                    width: CONFIG.CANVAS_WIDTH,
                    height: CONFIG.CANVAS_HEIGHT
                },
                exitedNaturally: car.x < -100 || car.x > CONFIG.CANVAS_WIDTH + 100 || 
                                car.y < -100 || car.y > CONFIG.CANVAS_HEIGHT + 100
            });
            if (this.onCarCompleted) {
                this.onCarCompleted(car);
            }
        });

        // Only remove cars that have genuinely completed their journey
        this.cars = this.cars.filter(car => car && !validCompletedCars.includes(car));
    }

    spawnCar() {
        const directions = [CONFIG.DIRECTIONS.NORTH, CONFIG.DIRECTIONS.EAST, CONFIG.DIRECTIONS.SOUTH, CONFIG.DIRECTIONS.WEST];
        const direction = directions[Math.floor(Math.random() * directions.length)];
        
        // Ensure proper lane selection for direction
        const lane = Math.floor(Math.random() * 2); // Lane 0 or 1 (both go same direction)
        
        const spawnPoint = this.intersection.getSpawnPointForLane(direction, lane);
        const minSpacing = 60; // Reduced spacing for better traffic flow
        
        // Check for blocking cars in SAME DIRECTION and SAME LANE only
        const tooClose = this.cars.some(car => {
            if (car.fromDirection !== direction) return false;
            if (car.lane !== lane) return false; // Only check same lane
            
            const distance = utils.getDistance(car.x, car.y, spawnPoint.x, spawnPoint.y);
            return distance < minSpacing;
        });

        if (!tooClose) {
            const car = new Car({
                id: this.nextCarId++,
                direction: direction,
                intersection: this.intersection,
                lane: lane
            });
            this.cars.push(car);
            console.log("Spawned car", car.id, "from", direction, "in lane", lane, "at", spawnPoint.x, spawnPoint.y);
        }
    }

    render(ctx) {
        this.cars.forEach(car => car.render(ctx));
    }

    reset() {
        this.cars = [];
        this.nextCarId = 1;
        this.spawnTimer = 0;
    }

    updateSettings(settings) {
        this.settings = { ...settings };
    }

    // Getters for external systems
    getCars() {
        return [...this.cars];
    }

    getWaitingCars(direction) {
        return this.cars.filter(car => car.getDirection() === direction && car.isWaiting());
    }

    getCurrentCarCount() {
        return this.cars.length;
    }
}