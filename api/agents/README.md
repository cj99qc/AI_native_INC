# CREATE FILE: api/agents/README.md

# Agent Orchestration System

This directory contains the LangChain-style agent orchestration layer for the AI_native_INC platform. The agent system provides intelligent automation of complex workflows by coordinating multiple microservices.

## Overview

The agent orchestration system follows these key principles:

- **Safe by Default**: No automatic money moves - all financial actions require explicit confirmation
- **Auditable**: All tool calls are logged with request IDs for traceability
- **Feature Flagged**: Controlled by `FEATURE_AGENT_ORCHESTRATION` environment variable
- **Fallback Capable**: Graceful degradation when services are unavailable
- **Rate Limited**: Configurable timeouts and maximum tool calls per request

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │ Agent Controller│    │ Tool Wrappers   │
│                 │───▶│                 │───▶│                 │
│ /api/agent/run  │    │ Intent → Plan   │    │ pricing, routing│
└─────────────────┘    │ Plan → Execute  │    │ rag, escrow     │
                       └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Microservices   │
                       │                 │
                       │ pricing_service │
                       │ routing_service │
                       │ rag_agent       │
                       │ escrow_service  │
                       └─────────────────┘
```

## Components

### Agent Controller (`agent_controller.js`)

The main orchestration engine that:

1. **Intent Classification**: Analyzes user prompts to determine intent
2. **Parameter Extraction**: Extracts relevant parameters from natural language
3. **Action Planning**: Plans sequence of tool calls based on intent
4. **Tool Execution**: Executes tools with proper error handling and logging
5. **Response Generation**: Combines results into coherent responses

### Tool Wrappers

Each tool wrapper provides a consistent interface to microservices:

#### Pricing Tool (`tools/pricing.js`)
- **Actions**: `calculate`, `estimate`, `bulk_calculate`
- **Features**: Fallback pricing, bulk operations, validation
- **Safety**: Input validation, reasonable limits

#### Routing Tool (`tools/routing.js`)
- **Actions**: `optimize`, `batch`, `estimate_time`, `find_route`
- **Features**: Geocoding, distance calculation, batch optimization
- **Safety**: Location validation, timeout handling

#### RAG Tool (`tools/rag.js`)
- **Actions**: `query`, `search`, `ingest`, `get_stats`
- **Features**: RAG v2 support, backward compatibility, PII handling
- **Safety**: Query validation, content filtering

#### Escrow Tool (`tools/escrow.js`)
- **Actions**: `check_status`, `hold_funds`, `release_funds`, `dispute`
- **Features**: PCI compliance, payment intent tracking
- **Safety**: **ALL PAYMENT ACTIONS REQUIRE EXPLICIT CONFIRMATION**

## Usage

### Basic Agent Request

```javascript
POST /api/agent/run
{
  "user_id": "user_123",
  "prompt": "Get me groceries from downtown, deliver by 5pm",
  "mode": "sync",
  "trace_id": "trace_456"
}
```

### Response Format

```javascript
{
  "status": "ok",
  "request_id": "req_789",
  "intent": "routing",
  "actions": [
    {
      "tool": "pricing",
      "action": "calculate",
      "success": true,
      "result": { "total_cost": 12.50 },
      "duration": 150
    },
    {
      "tool": "routing",
      "action": "optimize",
      "success": true,
      "result": { "estimated_time": 25 },
      "duration": 300
    }
  ],
  "final": {
    "message": "Found delivery option for $12.50, estimated 25 minutes",
    "details": { ... }
  },
  "processing_time_ms": 750
}
```

## Configuration

### Environment Variables

```bash
# Feature flag (required)
FEATURE_AGENT_ORCHESTRATION=true

# Agent configuration
AGENT_TIMEOUT_MS=30000
AGENT_MAX_TOOL_CALLS=10

# Service URLs (auto-configured in Docker)
PRICING_SERVICE_URL=http://localhost:8001
ROUTING_SERVICE_URL=http://localhost:8002
RAG_SERVICE_URL=http://localhost:8005
ESCROW_SERVICE_URL=http://localhost:8004

# RAG v2 feature flag
FEATURE_RAG_V2=true
```

### Integration with API Bridge

Add to `api/bridge.js`:

```javascript
const agentController = require('./agents/agent_controller');
app.use('/api/agent', agentController);
```

## Safety Features

### Financial Safety
- **No Automatic Payments**: All payment actions return confirmation requirements
- **PCI Compliance**: Only payment_intent_id stored, never raw card data
- **Audit Trail**: All financial tool calls logged with request IDs
- **Dry Run Support**: Test actions without real effects

### Operational Safety
- **Rate Limiting**: Maximum tool calls per request
- **Timeouts**: Configurable timeouts prevent hanging requests
- **Fallback Responses**: Graceful degradation when services unavailable
- **Input Validation**: All parameters validated before tool execution

### Security Features
- **Request ID Tracking**: End-to-end traceability
- **Error Sanitization**: No sensitive data in error messages
- **Service Isolation**: Tool wrappers prevent direct service access
- **Feature Flags**: Safe rollout with immediate disable capability

## Intent Classification

The system recognizes these intents:

- **pricing**: Cost calculations, fee estimates
- **routing**: Route optimization, delivery planning
- **search**: Information retrieval, knowledge queries
- **payment**: Payment status, escrow operations (requires confirmation)
- **general**: Fallback for unrecognized intents

## Adding New Tools

1. Create tool wrapper in `tools/` directory:
```javascript
class NewTool {
  constructor() {
    this.name = 'new_tool';
    this.description = 'Description of tool functionality';
  }
  
  getAvailableActions() {
    return ['action1', 'action2'];
  }
  
  async execute(action, params, context) {
    // Implementation
  }
  
  async healthCheck() {
    // Health check implementation
  }
}

module.exports = new NewTool();
```

2. Register in `agent_controller.js`:
```javascript
const newTool = require('./tools/new_tool');

const TOOLS = {
  // ... existing tools
  new_tool: newTool
};
```

3. Add intent patterns and planning logic

## Monitoring and Debugging

### Logging Format

All agent actions are logged in structured JSON:

```json
{
  "timestamp": "2025-01-09T10:30:00Z",
  "requestId": "req_123",
  "action": "tool_call_start",
  "details": {
    "tool": "pricing",
    "action": "calculate",
    "params": { ... }
  },
  "service": "agent_orchestration"
}
```

### Health Checks

- `GET /api/agent/health` - Agent system health
- `GET /api/agent/tools` - Available tools and capabilities

### Request Tracing

Use `X-Request-ID` header for end-to-end tracing across all services.

## Testing

### Unit Tests
```bash
npm test api/agents/
```

### Integration Tests
```bash
# Test with dry_run=true
curl -X POST http://localhost:3001/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test_user",
    "prompt": "Calculate delivery cost for $25 order",
    "dry_run": true
  }'
```

### Tool Health Checks
```bash
# Check all tool health
curl http://localhost:3001/api/agent/tools
```

## Deployment Checklist

- [ ] Set `FEATURE_AGENT_ORCHESTRATION=false` initially
- [ ] Verify all microservices are healthy
- [ ] Test with `dry_run=true` in staging
- [ ] Monitor error rates and response times
- [ ] Gradually enable with feature flag
- [ ] Set up alerts for failed tool calls
- [ ] Verify audit logs are being written

## Security Considerations

- **Never store sensitive data**: Use payment_intent_id, not card details
- **Validate all inputs**: Prevent injection attacks
- **Log security events**: Track unauthorized access attempts
- **Rate limit requests**: Prevent abuse
- **Sanitize outputs**: No sensitive data in responses
- **Regular security reviews**: Audit tool permissions and access patterns