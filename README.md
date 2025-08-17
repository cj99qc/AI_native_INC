# INC Logistics Platform

An AI-native logistics platform with cutting-edge batching, routing, pricing, and RAG capabilities built as microservices alongside a Next.js application.

## Architecture

The platform consists of:

- **Next.js App** (`inc/`): Main web application with existing API routes, Supabase integration, and Stripe payments
- **Microservices** (`services/`): Standalone FastAPI services for core logistics functionality  
- **API Bridge** (`api/`): Node.js proxy server that connects Next.js to microservices
- **Infrastructure** (`infra/`): Database migrations and configuration files

## Services

### Core Microservices

1. **Pricing Service** (Port 8001)
   - Deterministic pricing calculations using exact decimal arithmetic
   - Platform commissions, delivery fees, rural surcharges, driver payouts
   - Real-time pricing breakdown for orders

2. **Routing Service** (Port 8002)  
   - Order batching using K-means clustering with time windows
   - Route optimization using nearest neighbor + 2-opt heuristics
   - Optional OR-Tools VRP integration for advanced routing

3. **Matching Service** (Port 8003)
   - Multi-factor driver scoring (proximity, capacity, rating, availability)
   - Driver assignment with acceptance probability simulation
   - Real-time driver matching for batches

4. **Escrow Service** (Port 8004)
   - Payment state machine for holding and releasing funds
   - Mock Stripe integration (configurable to use real Stripe)
   - Dispute handling and refund processing

5. **RAG Agent** (Port 8005)
   - Document ingestion with sentence-transformers embeddings
   - Semantic search using FAISS or manual vector operations  
   - LLM-ready context retrieval for logistics queries

6. **Simulator Service**
   - End-to-end logistics pipeline simulation
   - KPI generation (delivery time, driver utilization, profit margins)
   - CSV export for analysis

### Supporting Components

- **API Bridge** (Port 3001): HTTP proxy connecting Next.js to microservices
- **PostgreSQL**: Database with new logistics tables (drivers, batches, routes, etc.)
- **Redis**: Optional caching layer

## Quick Start

### Option 1: Next.js Only (Existing Workflow)

```bash
cd inc
npm install
npm run dev
```

The Next.js app runs on `http://localhost:3000` with existing functionality intact.

### Option 2: Full Microservices Stack with Docker

```bash
# Clone and navigate to repository
cd AI_native_INC

# Start all services with Docker Compose
docker-compose up --build

# Services will be available at:
# - Next.js app: http://localhost:3000
# - API Bridge: http://localhost:3001
# - Individual services: http://localhost:8001-8005
```

### Option 3: Local Development

1. **Start individual services:**

```bash
# Terminal 1: Pricing Service
cd services/pricing_service
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8001

# Terminal 2: Routing Service  
cd services/routing_service
pip install -r requirements.txt
python -m uvicorn app:app --host 0.0.0.0 --port 8002

# Terminal 3: API Bridge
cd api
npm install
npm start

# Terminal 4: Next.js App
cd inc
npm install
USE_ROUTING_SERVICE=true npm run dev
```

2. **Optional: Start PostgreSQL and Redis locally**

```bash
# PostgreSQL with Docker
docker run --name inc-postgres -e POSTGRES_PASSWORD=inc_password -e POSTGRES_DB=inc_logistics -p 5432:5432 -d postgres:15

# Apply migrations
psql -h localhost -U postgres -d inc_logistics -f infra/supabase/new_tables.sql

# Redis with Docker
docker run --name inc-redis -p 6379:6379 -d redis:7-alpine
```

## Running the Simulator

Generate synthetic logistics scenarios and KPI metrics:

```bash
# Basic simulation with defaults (200 orders, 40 drivers)
python -m services.simulator.run --config config/defaults.json

# Custom scenario
python -m services.simulator.run --orders 100 --drivers 20 --output results/custom_kpis.csv

# Check the generated KPI CSV
cat out/kpi_summary.csv
```

Example output:
```
Metric,Value,Unit
Total Orders,200,count
Completion Rate,94.5,%
Driver Utilization,67.8,%
Avg Delivery Time,28.5,minutes
Gross Margin per Order,8.42,$
Platform Margin,13.2,%
```

## Testing

### Python Services (pytest)
```bash
cd services/pricing_service
pip install -r requirements.txt pytest
pytest tests/

cd services/routing_service  
pip install -r requirements.txt pytest
pytest tests/
```

### API Bridge (Jest)
```bash
cd api
npm install
npm test
```

### Integration Test
```bash
# Start all services first, then:
cd services/rag_agent
python ingest_docs.py http://localhost:8005

# Test pricing calculation
curl -X POST http://localhost:8001/price \
  -H "Content-Type: application/json" \
  -d '{"order_total": 40.0, "distance_km": 5.0}'

# Test routing via bridge  
curl -X POST http://localhost:3001/api/routing/batch \
  -H "Content-Type: application/json" \
  -d '{"orders": [{"id": "test", "pickup_lat": 45.42, "pickup_lng": -75.70, "delivery_lat": 45.41, "delivery_lng": -75.68}]}'
```

## Integration with Existing Next.js App

The existing `batch-optimize` API route (`inc/src/app/api/batch-optimize/route.ts`) has been enhanced to:

1. **Try the new routing service first** when `USE_ROUTING_SERVICE=true`
2. **Fallback to OpenAI** if the routing service is unavailable
3. **Maintain backward compatibility** - existing request/response shapes unchanged
4. **Add service indicator** in response to show which optimization was used

Enable integration by setting:
```bash
# In your .env.local or environment
USE_ROUTING_SERVICE=true
BRIDGE_URL=http://localhost:3001
```

## Configuration

Key configuration files:

- `config/defaults.json`: Platform-wide settings (fees, routing parameters, etc.)
- `infra/env.example`: Environment variables for all services  
- `docker-compose.yml`: Container orchestration
- `services/*/requirements.txt`: Python dependencies for each service

### Important Settings

```json
{
  "commission_platform_delivered_pct": 15.0,
  "delivery_fee_base": 5.99,
  "max_batch_size_orders": 8,
  "batch_window_minutes": 15,
  "rural_distance_threshold_km": 25.0
}
```

## Database Schema

New tables added to support logistics operations:

- `drivers` - Driver profiles and locations
- `batches` - Order groupings for efficient delivery  
- `routes` - Optimized delivery paths
- `route_stops` - Individual pickup/delivery points
- `escrow_payments` - Payment state management
- `sim_runs` - Simulation results and KPIs

See `infra/supabase/new_tables.sql` for complete schema.

## API Documentation  

### Pricing Service
- `POST /price` - Calculate complete pricing breakdown
- `GET /config` - Get current pricing configuration

### Routing Service  
- `POST /batch` - Create batches from orders
- `POST /route` - Optimize route for a batch

### Matching Service
- `POST /assign` - Find best driver for a batch  
- `POST /simulate_acceptance` - Predict driver acceptance probability

### Escrow Service
- `POST /hold_funds` - Hold payment for order
- `POST /release_funds` - Release funds after completion
- `POST /dispute` - Handle payment disputes

### RAG Service
- `POST /query` - Query logistics knowledge base
- `POST /ingest` - Add documents to knowledge base

All services expose `/health` for monitoring.

## Environment Variables

Copy `infra/env.example` to `.env.local` in the `inc/` directory and configure:

### Required for Integration
```bash
USE_ROUTING_SERVICE=true
BRIDGE_URL=http://localhost:3001
DOCKER_ENV=false  # Set to true when using Docker Compose
```

### External Services  
```bash
SUPABASE_URL=your_supabase_url
OPENAI_API_KEY=your_openai_key
STRIPE_SECRET_KEY=your_stripe_key
```

### Database
```bash
DATABASE_URL=postgresql://inc_user:inc_password@localhost:5432/inc_logistics
```

## Monitoring and Scaling

### Health Checks
All services provide `/health` endpoints for monitoring:

```bash
curl http://localhost:8001/health  # Pricing
curl http://localhost:8002/health  # Routing  
curl http://localhost:8003/health  # Matching
curl http://localhost:8004/health  # Escrow
curl http://localhost:8005/health  # RAG
```

### Docker Health Checks  
Services include Docker health check configurations with automatic restart policies.

### Scaling Considerations
- Services are stateless and can be horizontally scaled
- PostgreSQL and Redis can be clustered for high availability
- API Bridge supports load balancing multiple service instances

## Development Guidelines

### Making Changes
1. **Never modify** `.next/`, `.env.local`, or build artifacts
2. **Add new environment variables** to `infra/env.example` (not `.env.local`)
3. **Keep changes minimal** - only extend existing functionality
4. **Maintain backward compatibility** for existing API endpoints

### Adding New Services
1. Create service directory under `services/`
2. Include Dockerfile, requirements.txt, and health endpoint
3. Add service to `docker-compose.yml`
4. Update API bridge with proxy routes
5. Add configuration options to `config/defaults.json`

## Troubleshooting

### Services Won't Start
```bash
# Check port availability
lsof -i :8001-8005

# Check Docker logs
docker-compose logs pricing_service
docker-compose logs routing_service
```

### Integration Issues
```bash
# Verify bridge connectivity
curl http://localhost:3001/health
curl http://localhost:3001/api/services

# Check Next.js environment
echo $USE_ROUTING_SERVICE
echo $BRIDGE_URL
```

### Simulation Errors
```bash
# Missing dependencies
cd services/pricing_service && pip install -r requirements.txt
cd services/routing_service && pip install -r requirements.txt

# OR-Tools not available (expected - will use heuristic fallback)
python -m services.simulator.run --config config/defaults.json
```

## Production Deployment

### Security Considerations
- Use real Stripe keys and enable webhook validation
- Set up proper SSL/TLS termination  
- Configure PostgreSQL with proper authentication
- Use Redis AUTH if deployed separately
- Enable CORS restrictions in production

### Recommended Architecture
```
Internet → Load Balancer → Next.js App → API Bridge → Microservices
                                     ↓
                                 PostgreSQL + Redis
```

### Environment Setup
1. Set `DOCKER_ENV=true` for container deployments
2. Use container orchestration (Kubernetes/ECS) for scaling
3. Set up monitoring with health check endpoints
4. Configure logging aggregation for all services

## Support

For issues or questions:
1. Check service health endpoints
2. Review Docker Compose logs  
3. Verify environment variable configuration
4. Test individual services before full integration

The platform is designed to degrade gracefully - if microservices are unavailable, the Next.js app will continue using OpenAI for route optimization.
