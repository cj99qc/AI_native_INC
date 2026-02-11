# Service Decoupling Architecture

## Overview

This document describes the service decoupling principles and architecture patterns used in the INC Logistics Platform. Proper decoupling ensures that services can be developed, deployed, and scaled independently while maintaining clear boundaries and interfaces.

## Decoupling Principles

### 1. No Direct Service-to-Service Imports

**Rule**: Services MUST NOT import classes, functions, or modules from other services.

**Correct**:
```python
# services/matching_service/app.py
# ✓ Correct - no imports from other services
from fastapi import FastAPI
from pydantic import BaseModel
```

**Incorrect**:
```python
# services/matching_service/app.py
# ✗ WRONG - importing from another service
from services.escrow_service.app import EscrowStateMachine  # NEVER DO THIS
from services.pricing_service.pricing import PricingEngine  # NEVER DO THIS
```

### 2. Use the API Bridge for Inter-Service Communication

**Rule**: All inter-service communication MUST go through the API Bridge using HTTP requests.

**Architecture**:
```
Service A → API Bridge → Service B
```

**Example - Correct Inter-Service Communication**:
```python
import requests

# Call escrow service through the bridge
bridge_url = os.getenv("BRIDGE_URL", "http://localhost:3001")
response = requests.post(
    f"{bridge_url}/api/escrow/hold",
    json={"order_id": "123", "amount_cents": 5000}
)
```

**Fallback Pattern** (for development):
```python
# Try bridge first, fallback to direct service
try:
    response = requests.post(f"{bridge_url}/api/escrow/hold", json=data)
except requests.exceptions.RequestException:
    # Fallback to direct service URL
    escrow_url = os.getenv("ESCROW_SERVICE_URL", "http://localhost:8004")
    response = requests.post(f"{escrow_url}/hold_funds", json=data)
```

### 3. Service Boundaries

Each service owns its domain logic and data:

| Service | Domain | Responsibilities |
|---------|--------|------------------|
| **Pricing Service** | Financial calculations | Order pricing, fees, driver payouts |
| **Routing Service** | Logistics optimization | Batching, route optimization |
| **Matching Service** | Driver assignment | Driver scoring, acceptance prediction |
| **Escrow Service** | Payment state management | Hold/release funds, disputes, refunds |
| **RAG Service** | Knowledge retrieval | Document ingestion, semantic search |

**Rule**: Never implement domain logic from one service inside another service.

**Incorrect Example**:
```python
# services/matching_service/app.py
# ✗ WRONG - implementing escrow logic in matching service
def hold_escrow_funds(order_id, amount):
    # This is escrow service's responsibility!
    escrow_record = create_escrow(order_id, amount)
    stripe.capture_payment(...)
```

**Correct Example**:
```python
# services/matching_service/app.py
# ✓ Correct - matching service calls escrow service via bridge
def assign_driver_with_escrow(driver_id, batch_id):
    # Matching service does driver assignment
    assignment = assign_driver(driver_id, batch_id)
    
    # Call escrow service for payment handling
    escrow_response = requests.post(
        f"{bridge_url}/api/escrow/hold",
        json={"driver_id": driver_id, "batch_id": batch_id, ...}
    )
    
    return {"assignment": assignment, "escrow": escrow_response.json()}
```

## API Bridge Configuration

### Service URLs

The bridge proxies requests to services:

```javascript
// api/bridge.js
const SERVICES = {
  pricing: process.env.PRICING_SERVICE_URL || 'http://localhost:8001',
  routing: process.env.ROUTING_SERVICE_URL || 'http://localhost:8002',
  matching: process.env.MATCHING_SERVICE_URL || 'http://localhost:8003',
  escrow: process.env.ESCROW_SERVICE_URL || 'http://localhost:8004',
  rag: process.env.RAG_SERVICE_URL || 'http://localhost:8005'
};
```

### Bridge Endpoints

| Bridge Endpoint | Target Service | Target Endpoint |
|----------------|----------------|-----------------|
| `POST /api/pricing/calculate` | Pricing Service | `POST /price` |
| `POST /api/routing/batch` | Routing Service | `POST /batch` |
| `POST /api/matching/assign` | Matching Service | `POST /assign` |
| `POST /api/escrow/hold` | Escrow Service | `POST /hold_funds` |
| `POST /api/escrow/release` | Escrow Service | `POST /release_funds` |
| `GET /api/escrow/:escrowId` | Escrow Service | `GET /escrow/:escrowId` |

## Testing Guidelines

### Unit Tests (Internal Service Testing)

**Allowed**: Unit tests CAN import from their own service to test internal logic.

```python
# services/matching_service/tests/test_matching.py
# ✓ Correct - testing internal matching service logic
from services.matching_service.app import MatchingEngine, Driver

def test_trajectory_score():
    engine = MatchingEngine({"seed": 42})
    score = engine.calculate_trajectory_score(...)
    assert score > 0.5
```

### Integration Tests (Cross-Service Testing)

**Required**: Integration tests MUST use HTTP API calls, not direct imports.

**Incorrect**:
```python
# test_trajectory_integration.py
# ✗ WRONG - direct imports from services
from services.routing_service.batching import BatchingEngine
from services.matching_service.app import MatchingEngine

batching_engine = BatchingEngine(config)
matching_engine = MatchingEngine(config)
```

**Correct**:
```python
# test_trajectory_integration.py
# ✓ Correct - using API calls
import requests

# Call routing service
response = requests.post(
    "http://localhost:3001/api/routing/batch",
    json={"orders": orders_data}
)
batches = response.json()["batches"]

# Call matching service
response = requests.post(
    "http://localhost:3001/api/matching/assign",
    json={"batch": batch_data, "available_drivers": drivers}
)
assignment = response.json()
```

### Simulator (Special Case)

The **simulator** (`services/simulator/run.py`) is a benchmarking and testing tool that:
- Generates synthetic data
- Tests the complete logistics pipeline
- Measures KPIs and performance

**Exception**: The simulator MAY import service internals directly because it's a development/testing tool that needs access to internal logic for benchmarking purposes. It is NOT a production service and does not participate in the runtime service architecture.

## Docker Compose Configuration

Services communicate via Docker network:

```yaml
# docker-compose.yml
services:
  pricing_service:
    ports:
      - "8001:8001"
  
  matching_service:
    ports:
      - "8003:8003"
  
  escrow_service:
    ports:
      - "8004:8004"
  
  bridge:
    environment:
      - DOCKER_ENV=true
      - PRICING_SERVICE_URL=http://pricing_service:8001
      - MATCHING_SERVICE_URL=http://matching_service:8003
      - ESCROW_SERVICE_URL=http://escrow_service:8004
```

## Development Workflow

### Adding a New Feature Requiring Multiple Services

1. **Design the API contracts** - Define request/response formats
2. **Implement in individual services** - Each service implements its domain logic
3. **Add bridge endpoints** - Update `api/bridge.js` with new proxy routes
4. **Test via API calls** - Write integration tests using HTTP requests
5. **Document the workflow** - Update service documentation

### Example: Adding Escrow to Driver Matching

**Step 1**: Design the workflow
```
1. Client → Matching Service: Assign driver
2. Matching Service → Escrow Service: Hold funds (via bridge)
3. Escrow Service → Matching Service: Escrow confirmation
4. Matching Service → Client: Assignment with escrow ID
```

**Step 2**: Implement in Matching Service
```python
# services/matching_service/app.py
@app.post("/assign_with_escrow")
async def assign_with_escrow(request: AssignmentRequest):
    # Step 1: Find best driver (matching service's logic)
    assignment = await assign_driver(request)
    
    # Step 2: Call escrow service via bridge
    bridge_url = os.getenv("BRIDGE_URL", "http://localhost:3001")
    escrow_response = requests.post(
        f"{bridge_url}/api/escrow/hold",
        json={
            "order_id": request.batch.id,
            "driver_id": assignment.recommended_driver.driver_id,
            "amount_cents": request.payment_amount
        }
    )
    
    # Step 3: Return combined result
    return {
        "assignment": assignment,
        "escrow": escrow_response.json()
    }
```

## Monitoring and Debugging

### Health Checks

All services expose `/health` endpoints:

```bash
curl http://localhost:8001/health  # Pricing
curl http://localhost:8003/health  # Matching
curl http://localhost:8004/health  # Escrow
```

### Bridge Status

Check bridge connectivity:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/services
```

### Debugging Service Communication

Enable verbose logging in the bridge to trace requests:

```javascript
// api/bridge.js
console.log(`Proxying ${method} ${path} to ${serviceUrl}`);
```

## Common Pitfalls

### ❌ Pitfall 1: Importing Service Classes

```python
# ✗ WRONG
from services.escrow_service.app import EscrowStateMachine
escrow = EscrowStateMachine()
```

**Fix**: Use HTTP API call
```python
# ✓ Correct
response = requests.post(f"{bridge_url}/api/escrow/hold", json=data)
```

### ❌ Pitfall 2: Shared Database Models

Don't share database models between services. Each service should define its own models.

```python
# ✗ WRONG - shared models
from common.models import Order  # Don't create shared model files

# ✓ Correct - each service has its own models
# services/matching_service/app.py
class MatchingOrder(BaseModel):
    id: str
    pickup_lat: float
    # ... matching service's view of an order
```

### ❌ Pitfall 3: Direct Database Access Across Services

Each service should own its data. Don't access another service's database tables directly.

## Benefits of Proper Decoupling

1. **Independent Deployment** - Deploy services separately without affecting others
2. **Technology Flexibility** - Use different languages/frameworks per service
3. **Scalability** - Scale services independently based on load
4. **Team Autonomy** - Teams can work on different services in parallel
5. **Fault Isolation** - Failures in one service don't cascade to others
6. **Testing** - Easier to test services in isolation

## Checklist for Code Reviews

- [ ] No direct imports from other services
- [ ] Inter-service communication uses the API bridge
- [ ] Each service owns its domain logic
- [ ] Integration tests use HTTP API calls
- [ ] Service endpoints are documented
- [ ] Health check endpoint is implemented
- [ ] Environment variables for service URLs are used
- [ ] Error handling for service communication failures

## References

- [API Bridge Implementation](api/bridge.js)
- [Service Architecture](README.md#architecture)
- [Docker Compose Configuration](docker-compose.yml)
- [Integration Test Example](test_trajectory_integration.py)
