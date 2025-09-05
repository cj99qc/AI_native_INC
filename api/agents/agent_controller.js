// CREATE FILE: api/agents/agent_controller.js

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// Import tool wrappers
const pricingTool = require('./tools/pricing');
const routingTool = require('./tools/routing');
const ragTool = require('./tools/rag');
const escrowTool = require('./tools/escrow');

const router = express.Router();

// Configuration
const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS) || 30000;
const MAX_TOOL_CALLS = parseInt(process.env.AGENT_MAX_TOOL_CALLS) || 10;
const ENABLE_AGENT_ORCHESTRATION = process.env.FEATURE_AGENT_ORCHESTRATION === 'true';

// Request/response logging utility
function logAgentAction(requestId, action, details) {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({
        timestamp,
        requestId,
        action,
        details,
        service: 'agent_orchestration'
    }));
}

// Available tools registry
const TOOLS = {
    pricing: pricingTool,
    routing: routingTool,
    rag: ragTool,
    escrow: escrowTool
};

// Simple intent classification (in production, use proper NLP)
function classifyIntent(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    // Define intent patterns
    const patterns = {
        pricing: ['price', 'cost', 'fee', 'charge', 'payment', 'bill'],
        routing: ['route', 'delivery', 'drive', 'distance', 'navigate', 'optimize'],
        search: ['find', 'search', 'look for', 'info', 'information', 'about'],
        payment: ['pay', 'escrow', 'hold funds', 'release', 'transaction']
    };
    
    const scores = {};
    for (const [intent, keywords] of Object.entries(patterns)) {
        scores[intent] = keywords.filter(keyword => lowerPrompt.includes(keyword)).length;
    }
    
    // Return the intent with highest score
    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) return 'general';
    
    return Object.keys(scores).find(intent => scores[intent] === maxScore);
}

// Extract parameters from user prompt (simplified NER)
function extractParameters(prompt, intent) {
    const params = {};
    
    // Extract common parameters
    const addressMatch = prompt.match(/(?:to|from|at)\s+([^,\n]+(?:street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln)[^,\n]*)/i);
    if (addressMatch) {
        params.location = addressMatch[1].trim();
    }
    
    // Extract numbers (prices, distances, etc.)
    const numberMatches = prompt.match(/\$?(\d+(?:\.\d{2})?)/g);
    if (numberMatches) {
        params.numbers = numberMatches.map(n => parseFloat(n.replace('$', '')));
    }
    
    // Extract times
    const timeMatch = prompt.match(/(?:by|before|at)\s+(\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))/i);
    if (timeMatch) {
        params.time = timeMatch[1];
    }
    
    // Intent-specific parameter extraction
    switch (intent) {
        case 'pricing':
            const orderValueMatch = prompt.match(/order\s+(?:of|for|worth)\s*\$?(\d+(?:\.\d{2})?)/i);
            if (orderValueMatch) {
                params.orderValue = parseFloat(orderValueMatch[1]);
            }
            break;
        
        case 'routing':
            const fromMatch = prompt.match(/from\s+([^,\n]+)/i);
            const toMatch = prompt.match(/to\s+([^,\n]+)/i);
            if (fromMatch) params.from = fromMatch[1].trim();
            if (toMatch) params.to = toMatch[1].trim();
            break;
        
        case 'search':
            // Extract search query (everything after search terms)
            const searchMatch = prompt.match(/(?:find|search|look for|about)\s+(.+)/i);
            if (searchMatch) {
                params.query = searchMatch[1].trim();
            }
            break;
    }
    
    return params;
}

// Plan agent actions based on intent and parameters
function planActions(intent, parameters, userContext = {}) {
    const actions = [];
    
    switch (intent) {
        case 'pricing':
            actions.push({
                tool: 'pricing',
                action: 'calculate',
                params: {
                    orderValue: parameters.orderValue || 25.00,
                    distance: parameters.numbers?.[0] || 5.0,
                    location: parameters.location || 'downtown'
                }
            });
            break;
        
        case 'routing':
            if (parameters.from && parameters.to) {
                actions.push({
                    tool: 'routing',
                    action: 'optimize',
                    params: {
                        from: parameters.from,
                        to: parameters.to,
                        deadline: parameters.time
                    }
                });
            }
            break;
        
        case 'search':
            actions.push({
                tool: 'rag',
                action: 'query',
                params: {
                    query: parameters.query || 'general information',
                    top_k: 3
                }
            });
            break;
        
        case 'payment':
            // Payment actions require explicit confirmation
            actions.push({
                tool: 'escrow',
                action: 'check_status',
                params: {},
                requiresConfirmation: true
            });
            break;
        
        default:
            // For general queries, try search first
            actions.push({
                tool: 'rag',
                action: 'query',
                params: {
                    query: parameters.query || intent,
                    top_k: 2
                }
            });
    }
    
    return actions;
}

// Execute a single tool action
async function executeTool(toolName, action, params, requestId, dryRun = false) {
    const startTime = Date.now();
    
    try {
        logAgentAction(requestId, 'tool_call_start', {
            tool: toolName,
            action: action,
            params: dryRun ? { ...params, dry_run: true } : params
        });
        
        const tool = TOOLS[toolName];
        if (!tool) {
            throw new Error(`Tool '${toolName}' not found`);
        }
        
        const result = await tool.execute(action, params, { requestId, dryRun });
        const duration = Date.now() - startTime;
        
        logAgentAction(requestId, 'tool_call_success', {
            tool: toolName,
            action: action,
            duration,
            resultSize: JSON.stringify(result).length
        });
        
        return {
            tool: toolName,
            action: action,
            success: true,
            result: result,
            duration: duration
        };
        
    } catch (error) {
        const duration = Date.now() - startTime;
        
        logAgentAction(requestId, 'tool_call_error', {
            tool: toolName,
            action: action,
            error: error.message,
            duration
        });
        
        return {
            tool: toolName,
            action: action,
            success: false,
            error: error.message,
            duration: duration
        };
    }
}

// Generate final response based on action results
function generateResponse(intent, actionResults, originalPrompt) {
    const successfulResults = actionResults.filter(r => r.success);
    const errors = actionResults.filter(r => !r.success);
    
    if (successfulResults.length === 0) {
        return {
            message: "I encountered some issues processing your request. Please try again or rephrase your question.",
            errors: errors.map(e => e.error)
        };
    }
    
    let response = { message: "", details: {} };
    
    switch (intent) {
        case 'pricing':
            const pricingResult = successfulResults.find(r => r.tool === 'pricing');
            if (pricingResult) {
                response.message = `Based on your request, the estimated delivery cost is $${pricingResult.result.total_cost || 'N/A'}.`;
                response.details.pricing = pricingResult.result;
            }
            break;
        
        case 'routing':
            const routingResult = successfulResults.find(r => r.tool === 'routing');
            if (routingResult) {
                response.message = `I found an optimized route for your delivery.`;
                response.details.routing = routingResult.result;
            }
            break;
        
        case 'search':
            const ragResult = successfulResults.find(r => r.tool === 'rag');
            if (ragResult && ragResult.result.results) {
                response.message = `Here's what I found related to your query:`;
                response.details.search_results = ragResult.result.results;
            }
            break;
        
        case 'payment':
            const escrowResult = successfulResults.find(r => r.tool === 'escrow');
            if (escrowResult) {
                response.message = "Payment status checked. Any payment actions require explicit confirmation.";
                response.details.payment = escrowResult.result;
                response.requiresConfirmation = true;
            }
            break;
        
        default:
            response.message = "I've processed your request. Here are the results:";
            response.details.all_results = successfulResults.map(r => ({
                tool: r.tool,
                result: r.result
            }));
    }
    
    if (errors.length > 0) {
        response.warnings = errors.map(e => `${e.tool}: ${e.error}`);
    }
    
    return response;
}

// Main agent run endpoint
router.post('/run', async (req, res) => {
    // Check if agent orchestration is enabled
    if (!ENABLE_AGENT_ORCHESTRATION) {
        return res.status(501).json({
            error: "Agent orchestration is disabled. Set FEATURE_AGENT_ORCHESTRATION=true to enable."
        });
    }
    
    const requestId = req.headers['x-request-id'] || uuidv4();
    const startTime = Date.now();
    
    try {
        const { user_id, prompt, mode = 'sync', trace_id, dry_run = false } = req.body;
        
        if (!prompt) {
            return res.status(400).json({
                error: "Missing required field: prompt"
            });
        }
        
        logAgentAction(requestId, 'agent_run_start', {
            user_id,
            mode,
            trace_id,
            dry_run,
            prompt_length: prompt.length
        });
        
        // Step 1: Classify intent
        const intent = classifyIntent(prompt);
        
        // Step 2: Extract parameters
        const parameters = extractParameters(prompt, intent);
        
        // Step 3: Plan actions
        const plannedActions = planActions(intent, parameters, { user_id });
        
        logAgentAction(requestId, 'agent_plan', {
            intent,
            parameters,
            planned_actions: plannedActions.length
        });
        
        // Step 4: Execute actions
        const actionResults = [];
        
        for (let i = 0; i < plannedActions.length && i < MAX_TOOL_CALLS; i++) {
            const action = plannedActions[i];
            
            // Check if action requires confirmation and we're not in dry run
            if (action.requiresConfirmation && !dry_run) {
                actionResults.push({
                    tool: action.tool,
                    action: action.action,
                    success: true,
                    result: {
                        message: "This action requires explicit user confirmation",
                        requires_confirmation: true,
                        action_details: action
                    }
                });
                continue;
            }
            
            const result = await executeTool(
                action.tool,
                action.action,
                action.params,
                requestId,
                dry_run
            );
            
            actionResults.push(result);
        }
        
        // Step 5: Generate response
        const finalResponse = generateResponse(intent, actionResults, prompt);
        
        const totalDuration = Date.now() - startTime;
        
        logAgentAction(requestId, 'agent_run_complete', {
            intent,
            actions_executed: actionResults.length,
            total_duration: totalDuration,
            success: actionResults.some(r => r.success)
        });
        
        // Format response
        const response = {
            status: "ok",
            request_id: requestId,
            intent: intent,
            actions: actionResults,
            final: finalResponse,
            processing_time_ms: totalDuration
        };
        
        if (mode === 'async') {
            // In async mode, you would typically queue this for background processing
            response.task_id = requestId;
            response.status = "queued";
        }
        
        res.json(response);
        
    } catch (error) {
        const totalDuration = Date.now() - startTime;
        
        logAgentAction(requestId, 'agent_run_error', {
            error: error.message,
            total_duration: totalDuration
        });
        
        res.status(500).json({
            error: "Agent execution failed",
            message: error.message,
            request_id: requestId
        });
    }
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: "healthy",
        service: "agent_orchestration",
        enabled: ENABLE_AGENT_ORCHESTRATION,
        tools: Object.keys(TOOLS),
        config: {
            timeout_ms: TIMEOUT_MS,
            max_tool_calls: MAX_TOOL_CALLS
        }
    });
});

// Get available tools
router.get('/tools', (req, res) => {
    if (!ENABLE_AGENT_ORCHESTRATION) {
        return res.status(501).json({
            error: "Agent orchestration is disabled"
        });
    }
    
    const toolInfo = {};
    for (const [name, tool] of Object.entries(TOOLS)) {
        toolInfo[name] = {
            name: name,
            description: tool.description || `${name} tool`,
            actions: tool.getAvailableActions ? tool.getAvailableActions() : ['execute']
        };
    }
    
    res.json({
        tools: toolInfo,
        enabled: ENABLE_AGENT_ORCHESTRATION
    });
});

module.exports = router;