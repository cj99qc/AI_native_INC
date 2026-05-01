# INC Platform: Product Blueprint & Build Progress

**Status:** Steps 1–2 Complete (Vendor Onboarding, Product Catalog). Steps 3–7 Queued.  
**Last Updated:** 2026-05-01  
**Maintainer Guide:** See `docs/progress/BUILD_ORCHESTRATOR.md`

---

## The Vision: Hyperlocal Marketplace + Logistics + Trust

INC is a **hyperlocal marketplace platform** where:

- **Vendors** (stores, restaurants, service providers) sign up and list products/services with location and hours
- **Customers** search via **LLM-powered interface** ("I need flour" → finds local vendors, "I want to bake a cake" → decomposes into ingredients + related services)
- **Platform** handles the hard part: **logistics** (batching orders, routing drivers, matching), **trust** (escrow payments, disputes), and **autonomy** (The Pulse pre-computes matches so drivers see jobs before they ask)

**Think:** Amazon for small local businesses + TaskRabbit for services + Instacart's logistics + Stripe's trust layer. All autonomous, all anticipatory.

---

## The Artery: Three Pillars

### 1. **The Pulse** — Logistics Flow
- Autonomous background worker continuously pre-computes optimal driver-batch matches
- Drivers don't search for jobs; the platform presents ranked opportunities
- K-means order batching → TSP route optimization → multi-factor driver scoring → stored in `pulse_matches` table
- Real-time payout estimation so drivers see "$420 in 22 minutes" before accepting

### 2. **The Handshake** — Trust Layer
- Escrow payment state machine: hold → release on delivery (or dispute → admin review → refund)
- Per-vendor payment splits (if an order has products from Store A + Store B, each gets own escrow)
- Automated trust: customer pays platform, platform holds, vendors ship, payment releases on delivery confirmation

### 3. **Decision Made Easy** — UX Psychology
- System decides, user confirms (not user decides from scratch)
- Show outcomes, not processes ("We found 3 bundles for you" not "Running K-means clustering...")
- Concrete numbers over vague descriptions ("$42 in 18 minutes" not "competitive payout")

---

## Product Architecture: 7 Consecutive Steps

Each step builds on the previous. Specs are in `docs/features/NN-{name}.md`.

### ✅ STEP 1: Vendor Onboarding (COMPLETE)

**What it does:** Vendors sign up with geolocation, business hours, KYC, and payout method.

**Files Modified:**
- Schema: `infra/supabase/master_schema.sql`, `inc/supabase/schema.sql`, `infra/supabase/new_tables.sql`
- Helper: `inc/src/lib/geocode.ts` (Nominatim with rate limiting + LRU cache)
- API: `inc/src/app/api/vendor/onboarding/route.ts`
- Form: `inc/src/app/vendor/onboarding/page.tsx` (hours editor, KYC fields, payout method)

**Acceptance Criteria (all met):**
- Vendor signup writes to `vendors` table (geolocation, hours JSONB, KYC fields)
- Address geocoded → `location` GEOGRAPHY column populated
- Form collects business hours (per weekday: open/close/closed)
- Form collects payout method (Stripe Connect / manual bank)
- Form collects KYC (license or tax ID)
- After submit, `profiles.role` set to `vendor`

**Key Patterns:**
- Nominatim geocoding (free, 1 req/sec, well-cached)
- Hours stored as JSONB: `{"mon": {"open": "09:00", "close": "18:00", "closed": false}, ...}`
- Trigger `compute_vendor_location()` auto-computes GEOGRAPHY from lat/lng floats
- RLS policies enforce vendor ownership of their row

---

### ✅ STEP 2: Product Catalog (COMPLETE)

**What it does:** Vendors list products with images, categories, pricing, stock, and embeddings for semantic search.

**Files Created/Modified:**
- Schema: `inc/supabase/schema.sql` (product_categories + product extensions)
- Helpers: `inc/src/lib/supabase/storage.ts` (image upload to Supabase Storage), `inc/src/lib/embeddings.ts` (OpenAI embeddings)
- API: `inc/src/app/api/products/route.ts` (POST create, GET list), `inc/src/app/api/products/[id]/route.ts` (PATCH update, DELETE soft/hard)
- API: `inc/src/app/api/product-categories/route.ts` (GET categories for dropdowns)
- Forms: `inc/src/app/vendor/products/new/page.tsx` (create), `inc/src/app/vendor/products/[id]/edit/page.tsx` (edit)
- UI: `inc/src/app/dashboard/vendor/page.tsx` (dashboard buttons), `inc/src/app/product/[id]/page.tsx` (detail page)

**Acceptance Criteria (all met):**
- POST creates product owned by vendor's user ID (RLS enforces)
- PATCH/DELETE work with RLS ownership checks
- Form collects: name, description, price, category, unit, stock, up to 5 images
- Images upload to Supabase Storage bucket `product-images` → public URLs
- Product categories seeded (10 total: Groceries, Bakery, Hardware, Pharmacy, etc.)
- On create/update, embedding generated via `text-embedding-3-small` (non-fatal if OpenAI unavailable)
- Dashboard buttons wired: "Add Product" → `/vendor/products/new`, "Edit" → `/vendor/products/[id]/edit`
- Product detail page displays all fields (category, unit, currency, stock) + images

**Key Patterns:**
- Image management: create product first (empty images), upload sequentially, update product with URLs
- Embeddings: only regenerated when name/description/category changes (cost optimization)
- Soft-delete by default (`is_active=false`), hard-delete admin-only
- React Hook Form + Zod validation across both forms
- InC Psychology copy: "List a product", "Add to catalog"

---

### ⏭️ STEP 3: Multi-Service Providers (NEXT)

**What it does:** Vendors can list multiple services (e.g., plumber: leak repair $80, drain unblock $40/hr, inspection $30) each with individual pricing, duration, and hours.

**Planned Files:**
- Schema: Add `services` table (vendor_id, name, description, category, base_price, currency, duration, hours JSONB, is_active)
- API: `inc/src/app/api/services/route.ts` (CRUD)
- Dashboard: Update vendor dashboard to show services alongside products
- Discovery: `inc/src/app/services/[slug]/page.tsx` (list providers offering a specific service)

**Acceptance Criteria:**
- New `services` table with service-specific pricing + hours
- `/api/services/` CRUD routes
- Vendor dashboard shows services alongside products
- "Open now" badge on service cards (hours-aware)
- `service_categories` table seeded (plumber, electrician, carpenter, painter, cleaner, etc.)

**Why it matters:** Foundation for unified LLM search (Step 4) and checkout (Step 5).

---

### ⏱️ STEP 4: Unified LLM Search (Products + Services + Intent Parsing)

**What it does:** Single search bar handles three query types:
- **Direct product** ("flour") → find vendors selling flour nearby
- **Direct service** ("I need a plumber") → find plumbers + their services
- **Goal-oriented** ("I want to bake a cake") → decompose into ingredients (flour, sugar, eggs) + related services (bakery consultation, rental kitchen)

**Planned API:**
- `POST /api/search/unified` — query + location → intent + products + services
- Intent classifier (LLM call) → {product, service, goal, unknown}
- Goal decomposition → component queries
- Empty result fallback → "Nearest vendor is 5km away — expand search?"

**Why it matters:** Makes the platform feel anticipatory and smart, not a dumb list.

---

### ⏱️ STEP 5: Wire Checkout → Escrow + Batch + Driver Match

**What it does:** When customer checks out, system:
1. Calls pricing service for exact breakdown
2. Creates escrow record per vendor (payment hold)
3. Creates delivery batch (K-means + TSP)
4. Queries Pulse for pre-computed match (if available)
5. Falls back to on-demand matching
6. Assigns driver → order transitions to "assigned"
7. Driver picks up → "picking_up" → in transit → "in_transit" → delivered → "delivered"
8. On delivery confirmation, escrow releases vendor payment

**Why it matters:** Everything before this was setup; this is where the platform actually _works_ end-to-end.

---

### ⏱️ STEP 6: Reviews & Ratings

**What it does:** After delivery, customers rate vendors, products, drivers, service providers. Ratings aggregate to stars on every entity. Vendors can respond to reviews.

**Schema:**
- `reviews` table (author_id, subject_type, subject_id, order_id, rating 1–5, body)
- `subject_responses` table (vendor/driver reply, one per review)

**Why it matters:** Trust signal. Vendors with 4.8★ get more orders. Bad actors get marked early.

---

### ⏱️ STEP 7: Surface The Pulse Matches in Driver Dashboard

**What it does:** Driver dashboard queries pre-computed Pulse matches and renders them as cards:
- "3 bundles waiting for you — best one earns ₹420 in 22 minutes"
- Each card shows: batch summary, match score, real payout estimate
- Tap → detail view → Accept/Decline

**Why it matters:** Completes The Pulse loop. Drivers see autonomously-optimized opportunities, not random jobs.

---

## Technical Architecture

### Database Schema (PostgreSQL + PostGIS)

**Core Tables:**
- `vendors` — business profile (geolocation, hours, KYC, rating)
- `products` — items listed by vendors (category, price, stock, embeddings)
- `product_categories` — taxonomy (hierarchical)
- `services` — services listed by vendors (pricing, duration, hours)
- `profiles` — auth.users extension (role, avatar)
- `orders` — customer purchase (status, total, vendor_id, customer_id)
- `batches` — grouped orders for efficient delivery
- `batch_items` — individual orders in batch (geolocation)
- `routes` — optimized delivery path (PostGIS LINESTRING)
- `escrow_payments` — payment state machine (hold/release/dispute/refund)
- `pulse_matches` — pre-computed driver-batch matches (expires_at)
- `reviews` — customer ratings (after delivery)
- `service_providers` — external service provider registry (Phase 1)

**All location columns use `GEOGRAPHY(POINT, 4326)`** (never Euclidean distance on lat/lng).

### Microservices (Already Built)

| Service | Port | Responsibility |
|---------|------|-----------------|
| Pricing Service | 8001 | Order pricing, fees, payouts, commissions |
| Routing Service | 8002 | K-means batching, TSP route optimization |
| Matching Service | 8003 | Driver scoring, Pulse worker (background) |
| Escrow Service | 8004 | Payment state machine (hold → release) |
| RAG Agent | 8005 | Semantic search, support ticket resolution |

All services communicate via **HTTP through API Bridge** (`api/bridge.js`). No direct imports.

### Next.js Frontend

| Page | Purpose |
|------|---------|
| `/vendor/onboarding` | Vendor signup form |
| `/dashboard/vendor` | Vendor dashboard (products, orders, stats) |
| `/vendor/products/new` | Create product form |
| `/vendor/products/[id]/edit` | Edit product form |
| `/product/[id]` | Product detail (public) |
| `/search` | Unified LLM search (Step 4) |
| `/checkout` | Multi-vendor checkout (Step 5) |
| `/orders/[id]` | Order tracking + live driver ETA |
| `/reviews/[id]` | Review detail/moderation |
| `/dashboard/driver` | Driver job queue + Pulse matches (Step 7) |

---

## Development Workflow

### Prerequisites

```bash
# 1. Install Node.js dependencies (Next.js + API Bridge)
cd inc && npm install
cd ../api && npm install

# 2. Install Python dependencies (microservices)
cd ../services/pricing_service && pip install -r requirements.txt
cd ../routing_service && pip install -r requirements.txt
cd ../matching_service && pip install -r requirements.txt
cd ../escrow_service && pip install -r requirements.txt

# 3. Set up environment variables
cp infra/env.example inc/.env.local
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY, STRIPE_SECRET_KEY, etc.
```

### Running Locally

```bash
# Option A: Full stack with Docker
docker-compose up --build

# Option B: Individual services (in separate terminals)
# Terminal 1: Next.js
cd inc && npm run dev

# Terminal 2: API Bridge
cd api && npm run dev

# Terminal 3: Pricing Service
cd services/pricing_service && python -m uvicorn app:app --host 0.0.0.0 --port 8001

# Terminal 4: Routing Service
cd services/routing_service && python -m uvicorn app:app --host 0.0.0.0 --port 8002

# ... and so on for other services
```

### Testing

```bash
# Next.js (in browser)
http://localhost:3000

# API Bridge health check
curl http://localhost:3001/health

# Individual service health
curl http://localhost:8001/health
curl http://localhost:8002/health
# ... etc
```

---

## Execution Rules for Next Agent

### 1. **Read First**
- This file (`PRODUCT_BLUEPRINT.md`) — understand the vision
- `docs/progress/BUILD_ORCHESTRATOR.md` — see 7-step plan + current status
- `docs/progress/project_status.md` — see what was built last session
- Feature spec at `docs/features/NN-{name}.md` — detailed acceptance criteria for the step you're building

### 2. **Understand Dependencies**
```
Step 1 (Vendor Onboarding) ✅
  ↓
Step 2 (Product Catalog) ✅
  ↓
Step 3 (Multi-Service Providers) ← NEXT
  ↓
Step 4 (LLM Search + Intent) ← can parallelize with 2, 3
  ↓
Step 5 (Checkout → Escrow + Batch) ← requires Steps 2, 3
  ↓
Step 6 (Reviews & Ratings) ← can parallelize with 5
Step 7 (Pulse Driver Dashboard) ← can parallelize with 5, 6
```

### 3. **Follow Architecture Rules**
- **No direct service imports.** All inter-service communication via HTTP through API Bridge.
- **PostGIS GEOGRAPHY for all locations.** Never Euclidean distance on lat/lng.
- **RLS policies + explicit checks** in API routes for security + good error messages.
- **React Hook Form + Zod** for form validation (established pattern).
- **InC Psychology copy** — outcomes, not processes. "We found a bundle for you" not "Running K-means..."

### 4. **Test Before Declaring Done**
- Type checking passes (`npm run build`, `python -m mypy`)
- Forms work in browser (create, edit, delete)
- API endpoints return expected responses (use Postman or curl)
- RLS policies enforce ownership
- Integration tests pass (if applicable)

### 5. **Commit After Each Step**
```bash
git commit -m "Step N: <title>

<2-3 sentence summary>

Co-Authored-By: Claude <email>"
```

### 6. **Update Memory**
After completing a step:
```bash
# Update docs/progress/project_status.md with:
# - What was built
# - Key files created/modified
# - Known issues or limitations
# - What's next

# Update docs/progress/BUILD_ORCHESTRATOR.md with:
# - Step X marked COMPLETE
# - Step X+1 marked NEXT
# - Status table updated
```

---

## Key Files at a Glance

### Documentation
- `PRODUCT_BLUEPRINT.md` ← You are here
- `docs/features/README.md` — Feature spec index
- `docs/features/01-vendor-onboarding.md` — Step 1 spec
- `docs/features/02-product-catalog.md` — Step 2 spec
- ... (Steps 3–7)
- `docs/progress/BUILD_ORCHESTRATOR.md` — Master task list + status
- `docs/progress/project_status.md` — Current step details

### Schema
- `infra/supabase/master_schema.sql` — Production source of truth (all tables, triggers, RLS, indices, sample data)
- `inc/supabase/schema.sql` — Next.js Supabase integration
- `infra/supabase/new_tables.sql` — Docker local dev init

### Next.js Application
- `inc/src/app/` — Pages and API routes
- `inc/src/lib/` — Utilities (geocoding, embeddings, storage, Supabase)
- `inc/src/components/` — UI components (shadcn/ui based)
- `inc/src/hooks/` — Custom hooks (useAuth, useQuery)

### Microservices
- `services/pricing_service/` — Order pricing + payouts
- `services/routing_service/` — Batching + route optimization
- `services/matching_service/` — Driver scoring + Pulse worker
- `services/escrow_service/` — Payment state machine
- `services/rag_agent/` — Semantic search
- `services/simulator/` — End-to-end pipeline testing

### API Bridge
- `api/bridge.js` — Express proxy to microservices
- `api/package.json` — Dependencies

### Configuration
- `config/defaults.json` — Platform-wide settings (commission rates, batch params, Pulse config)
- `infra/env.example` — Environment variable template
- `docker-compose.yml` — Docker stack orchestration
- `CLAUDE.md` — Project philosophy + architecture rules (read this!)

---

## Quick Checklist: What Has Been Built

- [x] Vendor onboarding (Step 1) — vendors sign up, geolocation, hours, KYC, payout method
- [x] Product catalog (Step 2) — vendors list products with images, categories, embeddings
- [ ] Multi-service providers (Step 3) — vendors list multiple services with individual pricing
- [ ] Unified LLM search (Step 4) — single search bar handles products, services, goals
- [ ] Checkout → Escrow + Batch (Step 5) — end-to-end order flow with payment holds
- [ ] Reviews & Ratings (Step 6) — customer ratings + vendor responses
- [ ] Pulse Driver Dashboard (Step 7) — drivers see pre-computed match opportunities

---

## Questions an AI Might Have

**Q: Why is everything microservices?**  
A: The Pulse and Escrow services need to run continuously in the background. Separating them as services lets them operate independently from the web server. Plus, services scale independently when load spikes.

**Q: Why PostGIS GEOGRAPHY not lat/lng?**  
A: Real-world distance calculations must use geodetic math (Earth is curved). `GEOGRAPHY(POINT, 4326)` does spheroidal distance. Euclidean distance on lat/lng is wildly inaccurate (e.g., at the equator 1° = 111km, but at 45° latitude 1° ≈ 79km).

**Q: Why are images stored in Supabase Storage, not the database?**  
A: Images are large binary blobs. Storing them in the DB makes queries slow. Supabase Storage is S3-backed and CDN-ready. We store URLs in the DB, images in cloud storage.

**Q: Why non-fatal embedding generation?**  
A: If OpenAI is down, we don't want the entire product creation to fail. Products are created without embeddings; they're just unsearchable until the embedding is added later. This is a trade-off: availability vs. search correctness.

**Q: What about mobile apps?**  
A: Next.js can be wrapped in React Native via Expo or Tauri. For now, focus on web. Mobile is v2.

**Q: How do we handle payment disputes?**  
A: Escrow service holds funds. Customer disputes → escrow transitions to "disputed" state. Admin reviews transaction → releases to vendor or refunds customer. All via RLS + audit log.

---

## What's Next

Start with **Step 3: Multi-Service Providers**. Read `docs/features/03-multi-service-providers.md` for detailed specs. This is the foundation for the LLM search to work across both products and services.

**Estimated effort:** 1–1.5 days of focused work.

---

**Last updated:** 2026-05-01  
**Maintained by:** Claude (AI assistant) + user (Amith)  
**Questions?** See CLAUDE.md for architecture details or docs/features/ for step specs.
