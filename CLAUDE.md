# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The Artery Project: Multi-Agent Environment

We are building a seamless, autonomous economic artery.

### Our Identity

- **We do not wait for user input; we anticipate.** The system proactively optimizes, batches, and matches without requiring constant user decisions.
- **"The Pulse"** - High-efficiency logistics. Rapid order batching, route optimization, and driver matching that keeps the platform flowing.
- **"The Handshake"** - Automated trust and escrow. Payment state management that builds confidence through automation.

### Architectural Rules

1. **Seamlessness:** Services must be decoupled but aware of each other via the API Bridge. No direct imports between services - all communication flows through HTTP.

2. **Geospatial First:** All distance calculations and driver matching MUST use PostGIS `GEOGRAPHY` types and geospatial operations. Never use simple Euclidean distance for real-world coordinates.

3. **InC Psychology:** UI messages focus on "Decision Made Easy" - the platform does the heavy lifting and presents clear recommendations:
   - ✓ "We found a bundle for you"
   - ✓ "Your best driver is 3 minutes away"
   - ✗ "Please select from 47 options"

### Code Style

- **FastAPI** for all microservices
- **Supabase/PostgreSQL** for shared state and data persistence
- Anticipatory design - services predict needs and pre-optimize
- Autonomous agents communicate via API Bridge, not user prompts

## Overview

INC Logistics Platform is an AI-native logistics platform with cutting-edge batching, routing, pricing, and RAG capabilities built as microservices alongside a Next.js application. The platform consists of:

- **Next.js App** (`inc/`): Main web application with API routes, Supabase integration, and Stripe payments
- **Microservices** (`services/`): Standalone FastAPI services for core logistics functionality
- **API Bridge** (`api/`): Node.js proxy server that connects Next.js to microservices
- **Infrastructure** (`infra/`): Database migrations and configuration files

## Development Commands

### Next.js Application

```bash
cd inc
npm install
npm run dev          # Start dev server with Turbopack
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
```

### Full Microservices Stack (Docker)

```bash
docker-compose up --build                    # Start all services
docker-compose logs [service_name]           # View logs for specific service
docker-compose down                          # Stop all services
```

### Individual Microservices (Local)

```bash
# Pricing Service (Port 8001)
cd services/pricing_service
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8001

# Routing Service (Port 8002)
cd services/routing_service
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8002

# Matching Service (Port 8003)
cd services/matching_service
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8003

# Escrow Service (Port 8004)
cd services/escrow_service
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8004

# RAG Agent (Port 8005)
cd services/rag_agent
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8005

# API Bridge (Port 3001)
cd api
npm install
npm start            # Production
npm run dev          # Development with nodemon
```

### Testing

```bash
# Python services (pytest)
cd services/pricing_service
pip install -r requirements.txt pytest
pytest tests/                              # All tests
pytest tests/test_pricing.py              # Single test file
pytest tests/test_pricing.py::test_name   # Single test

cd services/routing_service
pytest tests/

# API Bridge (Jest)
cd api
npm install
npm test             # All tests

# Integration tests (requires all services running)
python test_trajectory_integration.py
```

### Simulator

```bash
# Generate synthetic logistics scenarios and KPI metrics
python -m services.simulator.run --config config/defaults.json
python -m services.simulator.run --orders 100 --drivers 20 --output results/custom_kpis.csv
```

## Architecture Principles

### Service Decoupling (CRITICAL)

**All inter-service communication MUST go through the API Bridge using HTTP requests. Services MUST NOT import from each other.**

**Correct:**
```python
# Call another service via bridge
import requests
bridge_url = os.getenv("BRIDGE_URL", "http://localhost:3001")
response = requests.post(
    f"{bridge_url}/api/escrow/hold",
    json={"order_id": "123", "amount_cents": 5000}
)
```

**Incorrect:**
```python
# ✗ NEVER DO THIS
from services.escrow_service.app import EscrowStateMachine
from services.pricing_service.pricing import PricingEngine
```

**Exception:** The simulator (`services/simulator/`) is a benchmarking tool and MAY import service internals directly. Unit tests within a service MAY import from their own service.

**Integration tests MUST use HTTP API calls, not direct imports.**

### Service Boundaries

| Service | Port | Domain | Artery Function | Responsibilities |
|---------|------|--------|-----------------|------------------|
| **Pricing Service** | 8001 | Financial calculations | The Handshake | Order pricing, fees, driver payouts, commission calculations |
| **Routing Service** | 8002 | Logistics optimization | **The Pulse** | Batching (K-means), route optimization (TSP), geospatial clustering |
| **Matching Service** | 8003 | Driver assignment | **The Pulse** | Multi-factor driver scoring, trajectory matching, acceptance simulation |
| **Escrow Service** | 8004 | Payment state management | **The Handshake** | Hold/release funds, disputes, refunds, automated trust |
| **RAG Agent** | 8005 | Knowledge retrieval | Decision Support | Document ingestion, semantic search, context for automation |
| **API Bridge** | 3001 | Service orchestration | The Artery | HTTP proxy connecting all services seamlessly |

### API Bridge Routes

The bridge proxies requests from Next.js to microservices:

| Bridge Endpoint | Target Service | Target Endpoint |
|----------------|----------------|-----------------|
| `POST /api/pricing/calculate` | Pricing (8001) | `POST /price` |
| `POST /api/routing/batch` | Routing (8002) | `POST /batch` |
| `POST /api/routing/route` | Routing (8002) | `POST /route` |
| `POST /api/matching/assign` | Matching (8003) | `POST /assign` |
| `POST /api/escrow/hold` | Escrow (8004) | `POST /hold_funds` |
| `POST /api/escrow/release` | Escrow (8004) | `POST /release_funds` |
| `POST /api/rag/query` | RAG (8005) | `POST /query` |

All services expose `/health` endpoints for monitoring.

## InC Psychology: UI/UX Patterns

When writing user-facing messages, API responses, or UI components, follow the "Decision Made Easy" principle:

**✓ Good - Anticipatory and clear:**
- "We found 3 orders heading your way - accept to earn $42"
- "Bundle ready: 2.4km route, 18-minute delivery window"
- "Driver matched: Sarah (4.9★) arriving in 3 minutes"
- "Payment secured - funds will release on delivery confirmation"

**✗ Avoid - Passive or overwhelming:**
- "Select orders to batch (showing 1-50 of 127)"
- "Would you like to optimize your route?"
- "Please configure delivery preferences"
- "Review the following options and make a selection"

**Principles:**
- System decides, user confirms (not user decides from scratch)
- Show outcomes, not processes ("Bundle ready" not "K-means clustering complete")
- Concrete numbers over vague descriptions ("$42" not "competitive payout")
- Trust through automation ("Payment secured" not "Please hold payment manually")

## Next.js Integration

The existing `batch-optimize` API route (`inc/src/app/api/batch-optimize/route.ts`) has been enhanced to:

1. **Try the new routing service first** when `USE_ROUTING_SERVICE=true`
2. **Fallback to OpenAI** if the routing service is unavailable
3. **Maintain backward compatibility** - existing request/response shapes unchanged

Enable integration by setting:
```bash
USE_ROUTING_SERVICE=true
BRIDGE_URL=http://localhost:3001
```

## File Structure

### Core Services
```
services/
├── pricing_service/
│   ├── app.py              # FastAPI application
│   ├── pricing.py          # Core pricing logic (Decimal arithmetic)
│   ├── requirements.txt
│   └── tests/
│       └── test_pricing.py
├── routing_service/
│   ├── app.py              # FastAPI application
│   ├── batching.py         # K-means clustering for order batching
│   ├── routing.py          # Route optimization coordinator
│   ├── solver.py           # TSP solver (2-opt, OR-Tools)
│   ├── travel_time.py      # Distance/time calculations
│   └── tests/
├── matching_service/
│   ├── app.py              # Driver matching with trajectory scoring
│   └── tests/
├── escrow_service/
│   ├── app.py              # Payment state machine
│   └── tests/
├── rag_agent/
│   ├── app.py              # Semantic search and retrieval
│   └── tests/
└── simulator/
    └── run.py              # End-to-end pipeline simulation
```

### Next.js Application
```
inc/
├── src/
│   ├── app/
│   │   ├── (auth)/         # Authentication pages
│   │   ├── admin/          # Admin dashboard
│   │   ├── api/            # API routes
│   │   │   ├── batch-optimize/   # Route optimization (uses routing service)
│   │   │   ├── checkout/         # Stripe checkout
│   │   │   ├── orders/           # Order management
│   │   │   └── ...
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utility functions and Supabase client
│   └── middleware.ts       # Next.js middleware
├── package.json
└── README.md
```

### API Bridge
```
api/
├── bridge.js              # Express proxy server
├── package.json
└── tests/
    └── test_bridge.js
```

### Configuration
```
config/
└── defaults.json          # Platform-wide settings (fees, routing params, etc.)

infra/
├── env.example            # Environment variable template
└── supabase/
    └── new_tables.sql     # Database schema for logistics tables
```

## Configuration

Key configuration files:
- `config/defaults.json`: Platform-wide settings (commission rates, delivery fees, batch parameters, RAG config)
- `infra/env.example`: Template for all environment variables
- `docker-compose.yml`: Container orchestration

### Important Settings (`config/defaults.json`)

- `commission_platform_delivered_pct`: 15.0 (platform commission for delivered orders)
- `delivery_fee_base`: 5.99 (base delivery fee)
- `max_batch_size_orders`: 8 (maximum orders per batch)
- `batch_window_minutes`: 15 (time window for batching orders)
- `rural_distance_threshold_km`: 25.0 (distance threshold for rural surcharge)
- `seed`: 42 (random seed for reproducible simulations)

### Environment Variables

Copy `infra/env.example` to `.env.local` in the `inc/` directory for Next.js configuration.

Required for integration:
- `USE_ROUTING_SERVICE=true` - Enable routing service
- `BRIDGE_URL=http://localhost:3001` - API bridge URL
- `DOCKER_ENV=false` - Set to `true` when using Docker Compose

External services:
- `OPENAI_API_KEY` - OpenAI API key (for fallback routing and chat)
- `STRIPE_SECRET_KEY` - Stripe secret key
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` - Supabase credentials

## Database Schema

New tables added for logistics operations (see `infra/supabase/new_tables.sql`):

- `drivers` - Driver profiles, **locations (PostGIS GEOGRAPHY)**, and status
- `batches` - Order groupings for efficient delivery
- `routes` - Optimized delivery paths with **geospatial waypoints**
- `route_stops` - Individual pickup/delivery points with **PostGIS coordinates**
- `escrow_payments` - Payment state management (The Handshake)
- `sim_runs` - Simulation results and KPIs

**Geospatial First:** All location fields use PostgreSQL PostGIS `GEOGRAPHY` types for accurate distance calculations and spatial queries. Never use simple lat/lng columns with Euclidean distance.

## Key Technologies

- **Next.js 15** with Turbopack for the web application
- **FastAPI** for Python microservices
- **Express** for API bridge
- **Supabase** for authentication and database
- **Stripe** for payments
- **OpenAI** for chat and fallback routing
- **PostgreSQL** for data storage
- **Redis** (optional) for caching
- **Docker Compose** for local development

### Python Dependencies
- `fastapi`, `uvicorn` - Web framework
- `pydantic` - Data validation
- `numpy`, `scipy` - Numerical computations
- `scikit-learn` - K-means clustering
- `sentence-transformers` - RAG embeddings
- `pytest` - Testing

### Node.js Dependencies
- `next`, `react` - Web framework
- `@supabase/supabase-js` - Supabase client
- `stripe` - Payment processing
- `openai` - OpenAI SDK
- `express`, `axios` - API bridge
- `jest` - Testing (API bridge)

## Common Development Tasks

### Adding a New Microservice

1. Create service directory under `services/`
2. Include `Dockerfile`, `requirements.txt`, and `/health` endpoint
3. Add service to `docker-compose.yml`
4. Update API bridge (`api/bridge.js`) with proxy routes
5. Add configuration options to `config/defaults.json`
6. Document endpoints and update this file
7. **Design for anticipation:** Services should predict needs and pre-compute results where possible

**The Artery Pattern:** New services should follow the anticipatory model:
- Background optimization (don't wait for user requests)
- Push notifications of opportunities (drivers/batches/routes)
- Autonomous decision-making with user confirmation, not user initiation

### Making Changes to Existing Services

- **NEVER modify** `.next/`, `.env.local`, or build artifacts
- **Add new environment variables** to `infra/env.example` (not `.env.local`)
- **Maintain backward compatibility** for existing API endpoints
- **Test via HTTP API calls** in integration tests, not direct imports
- **Use PostGIS for all geospatial operations** - never Euclidean distance on lat/lng
- **Follow InC Psychology** - write anticipatory, decision-focused messages
- **Maintain The Artery flow** - services communicate via API Bridge only

### Testing Inter-Service Communication

1. Start all services (Docker Compose or manually)
2. Test individual service health: `curl http://localhost:800X/health`
3. Test bridge connectivity: `curl http://localhost:3001/health`
4. Test end-to-end flow: `python test_trajectory_integration.py`

### Debugging

```bash
# Check port availability
lsof -i :8001-8005

# Check Docker logs
docker-compose logs [service_name]

# Verify bridge connectivity
curl http://localhost:3001/api/services

# Check Next.js environment
echo $USE_ROUTING_SERVICE
echo $BRIDGE_URL
```

## Security Considerations

- Escrow service uses **mock Stripe by default** (`USE_REAL_STRIPE=false`)
- Set `USE_REAL_STRIPE=true` and configure webhook validation for production
- Rate limiting uses Upstash Redis
- PII redaction enabled by default (`PII_REDACTION=true`)
- Vector embeddings have 90-day TTL (`VECTOR_TTL_DAYS=90`)

## Troubleshooting

### Services Won't Start
- Check if ports 3000, 3001, 8001-8005 are available
- Verify Python/Node.js dependencies are installed
- Check Docker daemon is running (for Docker Compose)

### Integration Issues
- Verify `USE_ROUTING_SERVICE=true` and `BRIDGE_URL` are set
- Check all services are healthy via `/health` endpoints
- Review Docker Compose logs for service errors

### Simulation Errors
- Install all service dependencies first (`pip install -r requirements.txt`)
- OR-Tools is optional - will use heuristic fallback if unavailable
- Check `config/defaults.json` for simulation parameters

## The Artery Principles: Quick Reference

When in doubt, remember:

1. **Anticipate, don't wait** - Build systems that predict and pre-optimize
2. **The Pulse** - Keep logistics flowing through batching, routing, and matching
3. **The Handshake** - Automate trust through escrow and payment management
4. **Seamless decoupling** - API Bridge for all inter-service communication
5. **Geospatial first** - PostGIS GEOGRAPHY types for all location data
6. **Decision Made Easy** - Show users outcomes, not processes

Every feature should strengthen The Artery: making economic exchange smoother, faster, and more autonomous.
