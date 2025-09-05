// CREATE FILE: api/agents/tools/routing.js

const axios = require('axios');

class RoutingTool {
    constructor() {
        this.name = 'routing';
        this.description = 'Optimize delivery routes and calculate travel times';
        this.serviceUrl = process.env.DOCKER_ENV === 'true' 
            ? 'http://routing_service:8002'
            : process.env.ROUTING_SERVICE_URL || 'http://localhost:8002';
        this.timeout = 15000; // 15 second timeout for route optimization
    }

    getAvailableActions() {
        return ['optimize', 'batch', 'estimate_time', 'find_route'];
    }

    async execute(action, params, context = {}) {
        const { requestId, dryRun = false } = context;

        switch (action) {
            case 'optimize':
                return this.optimizeRoute(params, requestId, dryRun);
            
            case 'batch':
                return this.batchOptimize(params, requestId, dryRun);
            
            case 'estimate_time':
                return this.estimateTime(params, requestId, dryRun);
            
            case 'find_route':
                return this.findRoute(params, requestId, dryRun);
            
            default:
                throw new Error(`Unknown routing action: ${action}`);
        }
    }

    async optimizeRoute(params, requestId, dryRun = false) {
        try {
            const {
                from,
                to,
                deadline,
                waypoints = [],
                optimization = 'time',
                vehicleType = 'car'
            } = params;

            if (!from || !to) {
                throw new Error('Both "from" and "to" locations are required');
            }

            // Convert address strings to coordinates if needed
            const fromCoords = await this.geocodeIfNeeded(from);
            const toCoords = await this.geocodeIfNeeded(to);

            const requestData = {
                stops: [
                    {
                        id: 'start',
                        lat: fromCoords.lat,
                        lng: fromCoords.lng,
                        type: 'pickup'
                    },
                    ...waypoints.map((wp, idx) => ({
                        id: `waypoint_${idx}`,
                        lat: wp.lat || 0,
                        lng: wp.lng || 0,
                        type: wp.type || 'delivery'
                    })),
                    {
                        id: 'end',
                        lat: toCoords.lat,
                        lng: toCoords.lng,
                        type: 'delivery'
                    }
                ],
                vehicles: [{
                    id: 'vehicle_1',
                    start: 'start',
                    capacity: 10,
                    type: vehicleType
                }],
                options: {
                    optimize: optimization,
                    dry_run: dryRun
                }
            };

            if (deadline) {
                requestData.options.deadline = deadline;
            }

            if (requestId) {
                requestData.request_id = requestId;
            }

            console.log(`[RoutingTool] Optimize request:`, {
                requestId,
                from: typeof from === 'string' ? from : `${from.lat},${from.lng}`,
                to: typeof to === 'string' ? to : `${to.lat},${to.lng}`,
                waypoints: waypoints.length,
                dryRun
            });

            // Make request to routing service
            const response = await axios.post(`${this.serviceUrl}/route`, requestData, {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-routing'
                }
            });

            return {
                success: true,
                route: response.data.routes?.[0] || response.data.route,
                metrics: response.data.metrics,
                estimated_time: response.data.estimated_time_minutes,
                estimated_distance: response.data.estimated_distance_km,
                optimization_used: optimization,
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Routing service error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                // Service unavailable - provide fallback
                console.warn('[RoutingTool] Service unavailable, using fallback routing');
                return this.fallbackRouting(params, dryRun);
            } else {
                throw new Error(`Route optimization failed: ${error.message}`);
            }
        }
    }

    async batchOptimize(params, requestId, dryRun = false) {
        try {
            const { orders = [], driverLocation, maxBatchSize = 8 } = params;

            if (!Array.isArray(orders) || orders.length === 0) {
                throw new Error('Orders array is required for batch optimization');
            }

            if (orders.length > maxBatchSize) {
                throw new Error(`Batch optimization limited to ${maxBatchSize} orders at once`);
            }

            const requestData = {
                batch_id: `batch_${Date.now()}`,
                orders: orders.map((order, idx) => ({
                    id: order.id || `order_${idx}`,
                    pickup_lat: order.pickup?.lat || 0,
                    pickup_lng: order.pickup?.lng || 0,
                    delivery_lat: order.delivery?.lat || 0,
                    delivery_lng: order.delivery?.lng || 0,
                    priority: order.priority || 1,
                    estimated_prep_time_minutes: order.prepTime || 15
                })),
                driver_location: driverLocation,
                dry_run: dryRun
            };

            if (requestId) {
                requestData.request_id = requestId;
            }

            console.log(`[RoutingTool] Batch optimize request:`, {
                requestId,
                orderCount: orders.length,
                dryRun
            });

            // Make request to routing service
            const response = await axios.post(`${this.serviceUrl}/batch`, requestData, {
                timeout: this.timeout * 2, // Longer timeout for batch operations
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-batch-routing'
                }
            });

            return {
                success: true,
                batches: response.data.batches,
                routes: response.data.routes,
                summary: response.data.summary,
                optimization_score: response.data.optimization_score,
                total_orders: orders.length,
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Batch routing service error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                // Service unavailable - provide simple fallback
                console.warn('[RoutingTool] Service unavailable, using simple batch routing');
                return this.fallbackBatchRouting(params, dryRun);
            } else {
                throw new Error(`Batch route optimization failed: ${error.message}`);
            }
        }
    }

    async estimateTime(params, requestId, dryRun = false) {
        try {
            const { from, to, mode = 'driving' } = params;

            if (!from || !to) {
                throw new Error('Both "from" and "to" locations are required for time estimation');
            }

            // For time estimation, we can use a simpler approach
            const distance = this.calculateDistance(from, to);
            
            // Simple time estimation based on mode
            let avgSpeed; // km/h
            switch (mode) {
                case 'walking':
                    avgSpeed = 5;
                    break;
                case 'cycling':
                    avgSpeed = 15;
                    break;
                case 'driving':
                default:
                    avgSpeed = 40; // Urban driving
                    break;
            }

            const estimatedTimeHours = distance / avgSpeed;
            const estimatedTimeMinutes = Math.ceil(estimatedTimeHours * 60);

            return {
                success: true,
                estimated_time_minutes: estimatedTimeMinutes,
                estimated_distance_km: Math.round(distance * 100) / 100,
                mode: mode,
                avg_speed_kmh: avgSpeed,
                is_estimate: true,
                dry_run: dryRun
            };

        } catch (error) {
            throw new Error(`Time estimation failed: ${error.message}`);
        }
    }

    async findRoute(params, requestId, dryRun = false) {
        try {
            const { from, to, avoid = [], preferences = {} } = params;

            if (!from || !to) {
                throw new Error('Both "from" and "to" locations are required');
            }

            // This is a simplified route finding - in production you'd use a real routing service
            const fromCoords = await this.geocodeIfNeeded(from);
            const toCoords = await this.geocodeIfNeeded(to);

            const distance = this.calculateDistance(fromCoords, toCoords);
            const estimatedTime = Math.ceil((distance / 40) * 60); // 40 km/h average

            return {
                success: true,
                route: {
                    start: fromCoords,
                    end: toCoords,
                    waypoints: [], // Would be filled by real routing service
                    instructions: [
                        `Start at ${typeof from === 'string' ? from : `${from.lat},${from.lng}`}`,
                        `Drive approximately ${Math.round(distance)} km`,
                        `Arrive at ${typeof to === 'string' ? to : `${to.lat},${to.lng}`}`
                    ]
                },
                distance_km: Math.round(distance * 100) / 100,
                estimated_time_minutes: estimatedTime,
                avoid: avoid,
                preferences: preferences,
                dry_run: dryRun
            };

        } catch (error) {
            throw new Error(`Route finding failed: ${error.message}`);
        }
    }

    // Helper function to geocode addresses if needed
    async geocodeIfNeeded(location) {
        if (typeof location === 'object' && location.lat && location.lng) {
            return location;
        }

        // Simple geocoding fallback (in production, use a real geocoding service)
        const locationStr = location.toLowerCase();
        
        // Hardcoded coordinates for common locations (for demo purposes)
        const knownLocations = {
            'downtown': { lat: 45.4215, lng: -75.6972 },
            'university': { lat: 45.4235, lng: -75.6985 },
            'airport': { lat: 45.3555, lng: -75.7570 },
            'market': { lat: 45.4292, lng: -75.6900 }
        };

        for (const [key, coords] of Object.entries(knownLocations)) {
            if (locationStr.includes(key)) {
                return coords;
            }
        }

        // Default to downtown Ottawa if no match
        console.warn(`[RoutingTool] Unknown location "${location}", using default coordinates`);
        return { lat: 45.4215, lng: -75.6972 };
    }

    // Calculate haversine distance between two points
    calculateDistance(point1, point2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(point2.lat - point1.lat);
        const dLon = this.toRad(point2.lng - point1.lng);
        const lat1 = this.toRad(point1.lat);
        const lat2 = this.toRad(point2.lat);

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        
        return R * c;
    }

    toRad(degrees) {
        return degrees * (Math.PI/180);
    }

    // Fallback routing when service is unavailable
    fallbackRouting(params, dryRun = false) {
        const { from, to, optimization = 'time' } = params;
        
        const fromCoords = typeof from === 'object' ? from : { lat: 45.4215, lng: -75.6972 };
        const toCoords = typeof to === 'object' ? to : { lat: 45.4235, lng: -75.6985 };
        
        const distance = this.calculateDistance(fromCoords, toCoords);
        const estimatedTime = Math.ceil((distance / 40) * 60); // 40 km/h average

        return {
            success: true,
            route: {
                vehicle_id: 'vehicle_1',
                stops: ['start', 'end'],
                estimated_time: estimatedTime,
                distance_m: distance * 1000
            },
            metrics: {
                total_distance_km: distance,
                total_time_minutes: estimatedTime,
                optimization_score: 75 // Fallback score
            },
            estimated_time: estimatedTime,
            estimated_distance: distance,
            optimization_used: optimization,
            fallback_calculation: true,
            dry_run: dryRun
        };
    }

    fallbackBatchRouting(params, dryRun = false) {
        const { orders = [] } = params;
        
        // Simple fallback: group orders by proximity
        const totalDistance = orders.length * 5; // Assume 5km per order
        const totalTime = orders.length * 30; // Assume 30 minutes per order

        return {
            success: true,
            batches: [{
                id: 'batch_1',
                orders: orders.map(o => o.id),
                estimated_time: totalTime,
                estimated_distance: totalDistance
            }],
            routes: [{
                batch_id: 'batch_1',
                total_distance_km: totalDistance,
                total_time_minutes: totalTime,
                stops: orders.length * 2 // pickup + delivery per order
            }],
            summary: {
                total_batches: 1,
                total_orders: orders.length,
                total_distance_km: totalDistance,
                total_time_minutes: totalTime
            },
            optimization_score: 70,
            total_orders: orders.length,
            fallback_calculation: true,
            dry_run: dryRun
        };
    }

    async healthCheck() {
        try {
            const response = await axios.get(`${this.serviceUrl}/health`, {
                timeout: 2000
            });
            return {
                healthy: true,
                service: 'routing',
                response_time: response.headers['response-time'] || 'unknown'
            };
        } catch (error) {
            return {
                healthy: false,
                service: 'routing',
                error: error.message
            };
        }
    }
}

module.exports = new RoutingTool();