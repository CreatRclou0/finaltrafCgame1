import { CONFIG } from "./config.js";
import { utils } from './utils.js';
import { traj_precalc, trajFromSpec } from './paths.js';

export class Car {
    constructor({ id, direction, intersection, route = null, lane = 0 }) {
        this.id = id;
        this.fromDirection = direction;
        this.intersection = intersection;
        this.route = route || [direction, 'intersection', this.calculateToDirection()];
        this.lane = lane; // 0 = rightmost lane, 1 = second rightmost lane
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
        this.state = 'approaching'; // approaching, waiting, crossing, exiting, completed
        this.waitStartTime = null;
        this.totalWaitTime = 0;
        this.isInIntersection = false;
        this.pathProgress = 0;

        // Path and trajectory properties
        this.trajectorySpec = null;
        this.trajectoryDistance = 0;

        // Calculate target position for movement
        this.calculateTargetPosition();
    }

    calculateTurnType() {
        // Lane-based turn rules - NO LANE CHANGING
        // Lane 0 (rightmost): RIGHT TURNS ONLY
        // Lane 1 (second rightmost): LEFT TURNS OR STRAIGHT
        
        if (this.lane === 0) {
            // Rightmost lane: ALWAYS turn right
            return CONFIG.TURN_TYPES.RIGHT;
        } else if (this.lane === 1) {
            // Second rightmost lane: 70% straight, 30% left turn
            const rand = Math.random();
            if (rand < 0.7) return CONFIG.TURN_TYPES.STRAIGHT;
            else return CONFIG.TURN_TYPES.LEFT;
        }
        
        // Fallback (should not happen)
        return CONFIG.TURN_TYPES.STRAIGHT;
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
            case 'exiting':
                this.updateExiting(dt);
                break;
            default:
                console.warn("Car", this.id, "in unknown state:", this.state, "- setting to exiting");
                this.state = 'exiting'; // Safety fallback for unknown states
        }

        // Movement for non-crossing states
        if (this.speed > 0 && this.state !== 'crossing') {
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
        }

        // Check if car is in intersection
        this.isInIntersection = this.intersection.isInIntersection(this.x, this.y);
    }

    updateApproaching(dt, lightStates) {
        const stopLine = this.intersection.getStopLinePosition(this.fromDirection);
        const distanceToStop = this.getDistanceToStopLine(stopLine);
        
        // Check for cars ahead to maintain spacing
        const carAhead = this.checkForCarAhead();
        const shouldStopForCar = carAhead && this.getDistanceToCarAhead(carAhead) < 25;
        
        // Stop at red light or for car ahead
        if (distanceToStop <= 15 || shouldStopForCar) {
            if (lightStates[this.fromDirection] === CONFIG.LIGHT_STATES.RED || shouldStopForCar) {
                this.state = 'waiting';
                this.speed = 0;
                if (!shouldStopForCar && !this.waitStartTime) {
                    this.waitStartTime = Date.now();
                }
                return;
            }
        }
        
        // Continue approaching - slow down if approaching red light
        if (lightStates[this.fromDirection] === CONFIG.LIGHT_STATES.RED && distanceToStop < 40) {
            this.speed = Math.max(0, this.speed - 30 * dt);
        } else {
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
        
        // Check for car ahead before proceeding
        const carAhead = this.checkForCarAhead();
        const carTooClose = carAhead && this.getDistanceToCarAhead(carAhead) < 20;
        
        // Check if light allows proceeding
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
                    this.doSimpleTurn(dt);
                }
            } else {
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
                this.x = this.intersection.centerX;
                this.y = this.intersection.centerY;
            }
            
            // Update heading based on trajectory direction
            const lookAhead = Math.max(2, this.speed * 0.1);
            const nextPosition = trajFromSpec(this.trajectoryDistance + lookAhead, this.trajectorySpec);
            
            if (nextPosition && nextPosition.length >= 2) {
                const dx = nextPosition[0] - this.x;
                const dy = nextPosition[1] - this.y;
                if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                    this.angle = Math.atan2(dy, dx);
                }
            }
            
        } catch (error) {
            console.error("Error in followTurnTrajectory for car", this.id, error);
            throw error;
        }
    }

    initializeTrajectory() {
        try {
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
        const turnRadius = 20;
        const turnRate = this.speed / turnRadius;
        
        // Apply turn rate based on turn type
        if (this.turnType === CONFIG.TURN_TYPES.LEFT) {
            this.angle += turnRate * dt; // Turn left (counter-clockwise)
        } else if (this.turnType === CONFIG.TURN_TYPES.RIGHT) {
            this.angle -= turnRate * dt; // Turn right (clockwise)
        }
        
        // Move forward
        this.x += Math.cos(this.angle) * this.speed * dt;
        this.y += Math.sin(this.angle) * this.speed * dt;
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

    updateExiting(dt) {
        // Continue moving at normal speed in the direction we're facing
        this.speed = this.maxSpeed;

        // Check if we've reached the edge of the canvas
        let hasExited = false;

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
                return Math.max(0, stopLine.y1 - this.y - this.height/2);
            case CONFIG.DIRECTIONS.EAST:
                return Math.max(0, this.x - this.width/2 - stopLine.x1);
            case CONFIG.DIRECTIONS.SOUTH:
                return Math.max(0, this.y - this.height/2 - stopLine.y1);
            case CONFIG.DIRECTIONS.WEST:
                return Math.max(0, stopLine.x1 - this.x - this.width/2);
            default:
                return 0;
        }
    }

    render(ctx) {
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
            
            // Only check cars in the EXACT SAME LANE
            if (otherCar.lane !== this.lane) continue;
            
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
        const spawnInterval = (10000 / this.settings.CAR_SPAWN_RATE);
        if (this.spawnTimer >= spawnInterval) {
            this.spawnCar();
            this.spawnTimer = 0;
        }

        // Update existing cars
        this.cars.forEach(car => {
            car.maxSpeed = this.settings.CAR_SPEED;
            
            if (!car || typeof car.update !== 'function') {
                console.error("Invalid car object found, skipping update");
                return;
            }
            
            car.update(deltaTime, lightStates);
        });

        // Remove completed cars
        const completedCars = this.cars.filter(car => car && car.isCompleted());
        
        const validCompletedCars = completedCars.filter(car => {
            const hasExitedCanvas = car.x < -100 || car.x > CONFIG.CANVAS_WIDTH + 100 || 
                                   car.y < -100 || car.y > CONFIG.CANVAS_HEIGHT + 100;
            
            if (!hasExitedCanvas) {
                console.warn("Car", car.id, "marked as completed but hasn't exited canvas - keeping alive");
                car.state = 'exiting';
                return false;
            }
            return true;
        });
        
        validCompletedCars.forEach(car => {
            console.log("Removing completed car", car.id);
            if (this.onCarCompleted) {
                this.onCarCompleted(car);
            }
        });

        this.cars = this.cars.filter(car => car && !validCompletedCars.includes(car));
    }

    spawnCar() {
        const directions = [CONFIG.DIRECTIONS.NORTH, CONFIG.DIRECTIONS.EAST, CONFIG.DIRECTIONS.SOUTH, CONFIG.DIRECTIONS.WEST];
        const direction = directions[Math.floor(Math.random() * directions.length)];
        
        // Lane selection: 0 = rightmost (right turns only), 1 = second rightmost (left/straight)
        const lane = Math.floor(Math.random() * 2);
        
        const spawnPoint = this.intersection.getSpawnPointForLane(direction, lane);
        const minSpacing = 60;
        
        // Check for blocking cars in SAME DIRECTION and SAME LANE only
        const tooClose = this.cars.some(car => {
            if (car.fromDirection !== direction) return false;
            if (car.lane !== lane) return false;
            
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
            console.log("Spawned car", car.id, "from", direction, "in lane", lane, "turn type:", car.turnType);
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