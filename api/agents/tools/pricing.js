// CREATE FILE: api/agents/tools/pricing.js

const axios = require('axios');

class PricingTool {
    constructor() {
        this.name = 'pricing';
        this.description = 'Calculate delivery pricing and fees';
        this.serviceUrl = process.env.DOCKER_ENV === 'true' 
            ? 'http://pricing_service:8001'
            : process.env.PRICING_SERVICE_URL || 'http://localhost:8001';
        this.timeout = 5000; // 5 second timeout
    }

    getAvailableActions() {
        return ['calculate', 'estimate', 'bulk_calculate'];
    }

    async execute(action, params, context = {}) {
        const { requestId, dryRun = false } = context;

        switch (action) {
            case 'calculate':
                return this.calculatePricing(params, requestId, dryRun);
            
            case 'estimate':
                return this.estimatePricing(params, requestId, dryRun);
            
            case 'bulk_calculate':
                return this.bulkCalculate(params, requestId, dryRun);
            
            default:
                throw new Error(`Unknown pricing action: ${action}`);
        }
    }

    async calculatePricing(params, requestId, dryRun = false) {
        try {
            const {
                orderValue = 25.00,
                distance = 5.0,
                location = 'downtown',
                deliveryType = 'standard',
                urgency = 'normal'
            } = params;

            // Validate parameters
            if (orderValue < 0 || distance < 0) {
                throw new Error('Order value and distance must be positive numbers');
            }

            const requestData = {
                order_value: orderValue,
                distance_km: distance,
                location: location,
                delivery_type: deliveryType,
                urgency: urgency,
                dry_run: dryRun
            };

            if (requestId) {
                requestData.request_id = requestId;
            }

            // Log the pricing request
            console.log(`[PricingTool] Calculate request:`, {
                requestId,
                dryRun,
                orderValue,
                distance,
                location
            });

            // Make request to pricing service
            const response = await axios.post(`${this.serviceUrl}/calculate`, requestData, {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-pricing'
                }
            });

            return {
                success: true,
                total_cost: response.data.total_cost,
                breakdown: response.data.breakdown,
                currency: response.data.currency || 'USD',
                calculation_details: response.data.details,
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                // Service returned an error
                throw new Error(`Pricing service error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                // Service unavailable - provide fallback
                console.warn('[PricingTool] Service unavailable, using fallback calculation');
                return this.fallbackPricing(params, dryRun);
            } else {
                throw new Error(`Pricing calculation failed: ${error.message}`);
            }
        }
    }

    async estimatePricing(params, requestId, dryRun = false) {
        // For estimates, we can use simpler calculations
        try {
            const {
                orderValue = 25.00,
                distance = 5.0,
                location = 'downtown'
            } = params;

            // Use fallback calculation for quick estimates
            const estimate = this.fallbackPricing(params, dryRun);
            
            return {
                ...estimate,
                is_estimate: true,
                message: "This is a quick estimate. Use 'calculate' for precise pricing."
            };

        } catch (error) {
            throw new Error(`Pricing estimation failed: ${error.message}`);
        }
    }

    async bulkCalculate(params, requestId, dryRun = false) {
        try {
            const { orders = [] } = params;

            if (!Array.isArray(orders) || orders.length === 0) {
                throw new Error('Orders array is required for bulk calculation');
            }

            if (orders.length > 50) {
                throw new Error('Bulk calculation limited to 50 orders at once');
            }

            const requestData = {
                orders: orders.map(order => ({
                    order_value: order.orderValue || 25.00,
                    distance_km: order.distance || 5.0,
                    location: order.location || 'downtown',
                    delivery_type: order.deliveryType || 'standard'
                })),
                dry_run: dryRun
            };

            if (requestId) {
                requestData.request_id = requestId;
            }

            console.log(`[PricingTool] Bulk calculate request:`, {
                requestId,
                orderCount: orders.length,
                dryRun
            });

            // Make request to pricing service
            const response = await axios.post(`${this.serviceUrl}/bulk`, requestData, {
                timeout: this.timeout * 2, // Longer timeout for bulk operations
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-bulk-pricing'
                }
            });

            return {
                success: true,
                results: response.data.results,
                summary: response.data.summary,
                total_orders: orders.length,
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Bulk pricing service error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                // Service unavailable - calculate individually using fallback
                console.warn('[PricingTool] Service unavailable, using fallback for bulk calculation');
                
                const results = params.orders.map((order, index) => {
                    const fallback = this.fallbackPricing(order, dryRun);
                    return {
                        order_index: index,
                        total_cost: fallback.total_cost,
                        breakdown: fallback.breakdown
                    };
                });

                return {
                    success: true,
                    results: results,
                    summary: {
                        total_cost: results.reduce((sum, r) => sum + r.total_cost, 0),
                        order_count: results.length
                    },
                    fallback_used: true,
                    dry_run: dryRun
                };
            } else {
                throw new Error(`Bulk pricing calculation failed: ${error.message}`);
            }
        }
    }

    // Fallback pricing calculation when service is unavailable
    fallbackPricing(params, dryRun = false) {
        const {
            orderValue = 25.00,
            distance = 5.0,
            location = 'downtown',
            deliveryType = 'standard'
        } = params;

        // Simple fallback pricing logic based on common delivery patterns
        const baseFee = 5.99;
        const perKmFee = 1.25;
        const platformCommission = orderValue * 0.15; // 15%
        
        // Location-based adjustments
        const locationMultiplier = location.toLowerCase().includes('downtown') ? 1.1 : 1.0;
        
        // Delivery type adjustments
        const typeMultiplier = deliveryType === 'express' ? 1.5 : 1.0;
        
        const deliveryFee = (baseFee + (distance * perKmFee)) * locationMultiplier * typeMultiplier;
        const totalCost = deliveryFee + platformCommission;

        return {
            success: true,
            total_cost: Math.round(totalCost * 100) / 100, // Round to 2 decimal places
            breakdown: {
                base_fee: baseFee,
                distance_fee: Math.round(distance * perKmFee * 100) / 100,
                platform_commission: Math.round(platformCommission * 100) / 100,
                location_adjustment: Math.round((locationMultiplier - 1) * baseFee * 100) / 100,
                type_adjustment: Math.round((typeMultiplier - 1) * deliveryFee * 100) / 100
            },
            currency: 'USD',
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
                service: 'pricing',
                response_time: response.headers['response-time'] || 'unknown'
            };
        } catch (error) {
            return {
                healthy: false,
                service: 'pricing',
                error: error.message
            };
        }
    }
}

module.exports = new PricingTool();