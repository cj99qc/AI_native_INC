// CREATE FILE: api/agents/tools/escrow.js

const axios = require('axios');

class EscrowTool {
    constructor() {
        this.name = 'escrow';
        this.description = 'Manage payment escrow and financial transactions (PCI compliant)';
        this.serviceUrl = process.env.DOCKER_ENV === 'true' 
            ? 'http://escrow_service:8004'
            : process.env.ESCROW_SERVICE_URL || 'http://localhost:8004';
        this.timeout = 10000; // 10 second timeout
    }

    getAvailableActions() {
        return ['check_status', 'hold_funds', 'release_funds', 'dispute', 'get_balance'];
    }

    async execute(action, params, context = {}) {
        const { requestId, dryRun = false } = context;

        // ALL PAYMENT ACTIONS REQUIRE EXPLICIT CONFIRMATION
        const requiresConfirmation = ['hold_funds', 'release_funds', 'dispute'];
        
        if (requiresConfirmation.includes(action) && !dryRun) {
            return {
                success: false,
                message: `Action '${action}' requires explicit user confirmation and cannot be automated`,
                requires_confirmation: true,
                action_details: {
                    tool: 'escrow',
                    action: action,
                    params: params
                },
                security_note: "This is a safety measure to prevent unauthorized financial transactions"
            };
        }

        switch (action) {
            case 'check_status':
                return this.checkStatus(params, requestId, dryRun);
            
            case 'hold_funds':
                return this.holdFunds(params, requestId, dryRun);
            
            case 'release_funds':
                return this.releaseFunds(params, requestId, dryRun);
            
            case 'dispute':
                return this.createDispute(params, requestId, dryRun);
            
            case 'get_balance':
                return this.getBalance(params, requestId, dryRun);
            
            default:
                throw new Error(`Unknown escrow action: ${action}`);
        }
    }

    async checkStatus(params, requestId, dryRun = false) {
        try {
            const { escrow_id, order_id, payment_intent_id } = params;

            if (!escrow_id && !order_id && !payment_intent_id) {
                throw new Error('Either escrow_id, order_id, or payment_intent_id is required');
            }

            let endpoint;
            let identifier;
            
            if (escrow_id) {
                endpoint = `/escrow/${escrow_id}`;
                identifier = escrow_id;
            } else if (payment_intent_id) {
                endpoint = `/status?payment_intent_id=${payment_intent_id}`;
                identifier = payment_intent_id;
            } else {
                endpoint = `/status?order_id=${order_id}`;
                identifier = order_id;
            }

            console.log(`[EscrowTool] Status check request:`, {
                requestId,
                identifier,
                endpoint,
                dryRun
            });

            // Make request to escrow service
            const response = await axios.get(`${this.serviceUrl}${endpoint}`, {
                timeout: this.timeout,
                headers: {
                    'X-Request-ID': requestId || 'agent-escrow-status'
                }
            });

            return {
                success: true,
                escrow_status: response.data.status,
                amount: response.data.amount,
                currency: response.data.currency || 'USD',
                created_at: response.data.created_at,
                updated_at: response.data.updated_at,
                payment_intent_id: response.data.payment_intent_id, // PCI compliant - no card details
                order_id: response.data.order_id,
                metadata: response.data.metadata || {},
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Escrow service error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                console.warn('[EscrowTool] Service unavailable, using fallback status');
                return this.fallbackStatus(params, dryRun);
            } else {
                throw new Error(`Escrow status check failed: ${error.message}`);
            }
        }
    }

    async holdFunds(params, requestId, dryRun = false) {
        try {
            const {
                amount,
                currency = 'USD',
                order_id,
                customer_id,
                payment_method,
                description = 'Order payment hold'
            } = params;

            if (!amount || amount <= 0) {
                throw new Error('Valid amount is required for holding funds');
            }

            if (!order_id || !customer_id) {
                throw new Error('Both order_id and customer_id are required');
            }

            // IMPORTANT: Never store raw card details - use payment_intent_id only
            const requestData = {
                amount: Math.round(amount * 100), // Convert to cents
                currency: currency,
                order_id: order_id,
                customer_id: customer_id,
                description: description,
                payment_method: payment_method, // Should be payment_intent_id or payment_method_id
                capture_method: 'manual', // Hold funds without capturing
                metadata: {
                    source: 'agent_orchestration',
                    request_id: requestId
                }
            };

            console.log(`[EscrowTool] Hold funds request:`, {
                requestId,
                amount,
                currency,
                order_id,
                customer_id,
                dryRun
            });

            if (dryRun) {
                return {
                    success: true,
                    message: 'Dry run: Funds would be held in escrow',
                    estimated_hold: {
                        amount: amount,
                        currency: currency,
                        order_id: order_id,
                        estimated_fees: Math.round(amount * 0.029 * 100) / 100 // 2.9% estimation
                    },
                    dry_run: true
                };
            }

            // Make request to escrow service
            const response = await axios.post(`${this.serviceUrl}/hold_funds`, requestData, {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-escrow-hold'
                }
            });

            return {
                success: true,
                escrow_id: response.data.escrow_id,
                payment_intent_id: response.data.payment_intent_id,
                status: response.data.status,
                amount_held: response.data.amount / 100, // Convert back from cents
                currency: response.data.currency,
                order_id: order_id,
                expires_at: response.data.expires_at,
                dry_run: false
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Escrow hold error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                throw new Error('Escrow service unavailable - cannot hold funds');
            } else {
                throw new Error(`Hold funds failed: ${error.message}`);
            }
        }
    }

    async releaseFunds(params, requestId, dryRun = false) {
        try {
            const {
                escrow_id,
                payment_intent_id,
                amount,
                reason = 'Order completed successfully'
            } = params;

            if (!escrow_id && !payment_intent_id) {
                throw new Error('Either escrow_id or payment_intent_id is required');
            }

            const requestData = {
                escrow_id: escrow_id,
                payment_intent_id: payment_intent_id,
                amount: amount ? Math.round(amount * 100) : undefined, // Partial release if amount specified
                reason: reason,
                metadata: {
                    source: 'agent_orchestration',
                    request_id: requestId
                }
            };

            console.log(`[EscrowTool] Release funds request:`, {
                requestId,
                escrow_id,
                payment_intent_id,
                amount,
                dryRun
            });

            if (dryRun) {
                return {
                    success: true,
                    message: 'Dry run: Funds would be released',
                    estimated_release: {
                        escrow_id: escrow_id,
                        payment_intent_id: payment_intent_id,
                        amount: amount || 'full_amount',
                        reason: reason
                    },
                    dry_run: true
                };
            }

            // Make request to escrow service
            const response = await axios.post(`${this.serviceUrl}/release_funds`, requestData, {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-escrow-release'
                }
            });

            return {
                success: true,
                escrow_id: response.data.escrow_id,
                payment_intent_id: response.data.payment_intent_id,
                status: response.data.status,
                amount_released: response.data.amount_released / 100, // Convert back from cents
                currency: response.data.currency,
                transaction_id: response.data.transaction_id,
                released_at: response.data.released_at,
                dry_run: false
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Escrow release error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                throw new Error('Escrow service unavailable - cannot release funds');
            } else {
                throw new Error(`Release funds failed: ${error.message}`);
            }
        }
    }

    async createDispute(params, requestId, dryRun = false) {
        try {
            const {
                escrow_id,
                payment_intent_id,
                reason,
                description,
                evidence = {}
            } = params;

            if (!escrow_id && !payment_intent_id) {
                throw new Error('Either escrow_id or payment_intent_id is required');
            }

            if (!reason) {
                throw new Error('Dispute reason is required');
            }

            const requestData = {
                escrow_id: escrow_id,
                payment_intent_id: payment_intent_id,
                reason: reason,
                description: description || '',
                evidence: evidence,
                metadata: {
                    source: 'agent_orchestration',
                    request_id: requestId
                }
            };

            console.log(`[EscrowTool] Create dispute request:`, {
                requestId,
                escrow_id,
                payment_intent_id,
                reason,
                dryRun
            });

            if (dryRun) {
                return {
                    success: true,
                    message: 'Dry run: Dispute would be created',
                    estimated_dispute: {
                        escrow_id: escrow_id,
                        payment_intent_id: payment_intent_id,
                        reason: reason,
                        description: description
                    },
                    dry_run: true
                };
            }

            // Make request to escrow service
            const response = await axios.post(`${this.serviceUrl}/dispute`, requestData, {
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-ID': requestId || 'agent-escrow-dispute'
                }
            });

            return {
                success: true,
                dispute_id: response.data.dispute_id,
                escrow_id: response.data.escrow_id,
                status: response.data.status,
                reason: reason,
                created_at: response.data.created_at,
                estimated_resolution_time: response.data.estimated_resolution_time,
                dry_run: false
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Escrow dispute error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                throw new Error('Escrow service unavailable - cannot create dispute');
            } else {
                throw new Error(`Create dispute failed: ${error.message}`);
            }
        }
    }

    async getBalance(params, requestId, dryRun = false) {
        try {
            const { account_id, customer_id } = params;

            if (!account_id && !customer_id) {
                throw new Error('Either account_id or customer_id is required');
            }

            const queryParams = new URLSearchParams();
            if (account_id) queryParams.append('account_id', account_id);
            if (customer_id) queryParams.append('customer_id', customer_id);

            console.log(`[EscrowTool] Get balance request:`, {
                requestId,
                account_id,
                customer_id,
                dryRun
            });

            // Make request to escrow service
            const response = await axios.get(`${this.serviceUrl}/balance?${queryParams}`, {
                timeout: this.timeout,
                headers: {
                    'X-Request-ID': requestId || 'agent-escrow-balance'
                }
            });

            return {
                success: true,
                account_id: response.data.account_id,
                available_balance: response.data.available_balance / 100, // Convert from cents
                pending_balance: response.data.pending_balance / 100,
                total_balance: response.data.total_balance / 100,
                currency: response.data.currency || 'USD',
                last_updated: response.data.last_updated,
                dry_run: dryRun
            };

        } catch (error) {
            if (error.response) {
                throw new Error(`Escrow balance error: ${error.response.data.error || error.response.statusText}`);
            } else if (error.code === 'ECONNREFUSED') {
                console.warn('[EscrowTool] Service unavailable, using fallback balance');
                return this.fallbackBalance(params, dryRun);
            } else {
                throw new Error(`Get balance failed: ${error.message}`);
            }
        }
    }

    // Fallback status when service is unavailable
    fallbackStatus(params, dryRun = false) {
        return {
            success: true,
            escrow_status: 'unknown',
            amount: 0,
            currency: 'USD',
            message: 'Escrow service unavailable - status unknown',
            fallback_used: true,
            dry_run: dryRun
        };
    }

    // Fallback balance when service is unavailable
    fallbackBalance(params, dryRun = false) {
        return {
            success: true,
            account_id: params.account_id || 'unknown',
            available_balance: 0,
            pending_balance: 0,
            total_balance: 0,
            currency: 'USD',
            message: 'Escrow service unavailable - balance unknown',
            fallback_used: true,
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
                service: 'escrow',
                pci_compliant: true,
                response_time: response.headers['response-time'] || 'unknown'
            };
        } catch (error) {
            return {
                healthy: false,
                service: 'escrow',
                error: error.message
            };
        }
    }
}

module.exports = new EscrowTool();