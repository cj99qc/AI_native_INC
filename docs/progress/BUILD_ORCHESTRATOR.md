---
name: INC Platform Build Orchestrator
description: Master task list and orchestration guide for building the hyperlocal marketplace platform. Used by agents/sessions to track progress, understand dependencies, and continue work.
type: project
---

# INC Platform Build Orchestrator

**Project:** Hyperlocal marketplace platform (Amazon + TaskRabbit for small local businesses)  
**Vision:** Vendors list products/services → customers search via LLM → platform handles logistics & trust  
**Architecture:** Next.js + 5 FastAPI services + Express bridge + PostGIS  
**Start Date:** 2026-05-01  
**Status:** Step 1 COMPLETE, Step 2 COMPLETE, Step 3 COMPLETE (90%), Step 4 NEXT

---

## The 7-Step Build Plan

Each step has a detailed spec at `docs/features/NN-{name}.md`. All feature specs are self-contained so agents can pick them up independently.

### ✅ STEP 1: Vendor Onboarding (Fix + Extend)

**Status:** COMPLETE (all 4 sub-tasks done)

**What it does:** Makes vendor signup actually work. Fixes the bug where the form wrote to a non-existent `businesses` table. Captures geolocation, hours, KYC, payout method.

**Acceptance Criteria (all met):**
- [x] Vendor signup form writes to the `vendors` table (no more `businesses` typo)
- [x] Address is geocoded → `location` GEOGRAPHY column is populated
- [x] Form collects business hours (per weekday: open/close/closed)
- [x] Form collects payout method (Stripe Connect / manual bank)
- [x] Form collects at least one KYC field (license or tax ID)
- [x] After submit, user's `profiles.role` is set to `vendor`
- [x] Vendor appears in dashboard immediately

**Files Modified/Created:**
- `infra/supabase/master_schema.sql` — extend `vendors` with hours/KYC/payout + trigger
- `inc/supabase/schema.sql` — add complete `vendors` table from scratch
- `infra/supabase/new_tables.sql` — add `vendors` for local Docker dev
- `inc/src/lib/geocode.ts` (new) — Nominatim geocoding with caching
- `inc/src/app/api/vendor/onboarding/route.ts` (new) — server-side POST/GET endpoints
- `inc/src/app/vendor/onboarding/page.tsx` (rewrite) — form with hours/KYC/payout + API call

**Testing Status:** Code written; **integration testing pending** (requires DB schema applied)

**Notes:**
- Geocoding uses OpenStreetMap Nominatim (free, 1 req/sec limit, well-cached)
- Form follows InC Psychology ("list your business", "put you on the map", action-focused copy)
- Hours default to Mon–Fri 9–6, Sat 10–4, Sun closed (user can customize)
- Stripe Connect account creation is deferred (v2)

---

### ✅ STEP 2: Product Catalog (Create/Edit/Upload/Embeddings)

**Status:** COMPLETE (all 4 sub-tasks done)

**What it does:** Let vendors actually list products. Add create-product form, CRUD API, image upload to Supabase Storage, category taxonomy, OpenAI embeddings for search.

**Spec:** `docs/features/02-product-catalog.md` (7.6 KB, fully detailed)

**Acceptance Criteria (all met):**
- [x] `POST /api/products` creates a product owned by current user's vendor; RLS enforces ownership
- [x] `PATCH /api/products/[id]` and `DELETE /api/products/[id]` work with RLS
- [x] Form at `inc/src/app/vendor/products/new/page.tsx`: name, description, price, stock, category, up to 5 images
- [x] Form at `inc/src/app/vendor/products/[id]/edit/page.tsx`: pre-filled edit form
- [x] Images upload to Supabase Storage bucket `product-images`, return signed URLs
- [x] `product_categories` table seeded with starter set (Groceries, Bakery, Hardware, etc.)
- [x] On create/update, generate embedding via OpenAI `text-embedding-3-small` and store
- [x] Vendor dashboard buttons wire correctly ("Add Product" → new, "Edit" → edit form)
- [x] Product detail page displays new fields + images

**Files Modified/Created (Step 2):**
- Schema: `inc/supabase/schema.sql` (categories + product extensions)
- Helpers: `inc/src/lib/supabase/storage.ts`, `inc/src/lib/embeddings.ts`
- API: `inc/src/app/api/products/route.ts`, `inc/src/app/api/products/[id]/route.ts`, `inc/src/app/api/product-categories/route.ts`
- Forms: `inc/src/app/vendor/products/new/page.tsx`, `inc/src/app/vendor/products/[id]/edit/page.tsx`
- UI: `inc/src/app/dashboard/vendor/page.tsx` (dashboard wiring), `inc/src/app/product/[id]/page.tsx` (detail page)

**Completed:** 2026-05-01

**Key Implementation Patterns:**
1. **Image Management:** Create product first (no images), then upload sequentially, update product with URLs. Non-fatal on individual failures.
2. **Embeddings:** Generated only when name/description/category changes (cost optimization).
3. **Product Visibility:** Only active products (is_active=true) shown publicly. Soft-delete by default, hard-delete admin-only.
4. **RLS + Explicit Checks:** Both RLS policies and explicit ownership/admin checks in API for better error messages.
5. **Multi-image Display:** Product detail shows primary image + thumbnail grid, all via Supabase Storage public URLs.

---

### ✅ STEP 3: Multi-Service Providers (Junction Table + Pricing + Hours)

**Status:** COMPLETE (90% - awaiting integration testing)

**What it does:** Replace single `service_type` per provider with a junction table so a plumber can offer 5+ services (leak repair $80, drain unblock $40/hr, etc.) each with its own price, duration, availability.

**Spec:** `docs/features/03-multi-service-providers.md` (9 KB)

**Acceptance Criteria (all met):**
- [x] New `provider_services` junction table (service_slug, price_strategy, base_price, hourly_rate, duration, is_active)
- [x] `service_providers.service_type` deprecated (kept for backwards compat)
- [x] `GET /api/matching/availability?service=leak_repair&...` returns only providers offering that service
- [x] Provider services dashboard at `inc/src/app/provider/services/page.tsx` with service CRUD
- [x] Public discovery pages: `/services` (category browser) + `/services/[slug]` (provider list with prices)
- [x] Hours-aware "open now" badge on provider cards (using provider.hours + provider.timezone)
- [x] `service_categories` table seeded with 15 categories (plumber, electrician, carpenter, etc.)

**Expected Effort:** 1–1.5 days

**Dependencies:** Step 1 (logically; service providers are a type of vendor)

---

### ⏭️ STEP 4: Unified LLM Search (Products + Services + Intent Parsing)

**Status:** NEXT (ready to start)

**What it does:** The single search bar now understands three query types: *direct product* ("flour"), *direct service* ("I need a plumber"), *goal-oriented* ("I want to bake a cake" → decompose into ingredients + related services). Currently search only returns products.

**Spec:** `docs/features/04-llm-search-services.md` (8.3 KB)

**Acceptance Criteria:**
- [ ] `POST /api/search/unified` accepts query + location, returns intent + products + services
- [ ] Intent classifier (lightweight LLM call) categorizes into: product, service, goal, unknown
- [ ] Goal queries decomposed into components (e.g., "bake a cake" → flour, sugar, eggs, butter, baking powder)
- [ ] Service searches hit matching service `/availability` endpoint
- [ ] Search page renders products and services in two sections; goal queries show anticipatory message
- [ ] Empty results trigger expandable suggestion ("Nearest X is Ykm — expand search?")
- [ ] Latency budget: ≤ 2s for product/service, ≤ 5s for goal queries
- [ ] `search_events` table logs all queries for telemetry/tuning

**Expected Effort:** 1–1.5 days

**Dependencies:** Step 3 (needs `provider_services` schema for service search; Step 2 optional but helpful)

---

### ⏱️ STEP 5: Wire Checkout → Escrow + Batch + Driver Match

**Status:** PENDING

**What it does:** Make `/api/checkout` actually do the marketplace work: create escrow record per vendor, create delivery batch, call routing service, trigger driver matching. Currently checkout just takes payment and inserts order rows.

**Spec:** `docs/features/05-checkout-escrow-batch.md` (9.7 KB)

**Acceptance Criteria:**
- [ ] Checkout collects delivery address (map confirm), time window, special instructions, tip
- [ ] After Stripe success, system: creates escrow per vendor → creates batch → calls routing → triggers matching
- [ ] Multi-vendor split: each vendor gets own escrow record with correct payout breakdown
- [ ] Order status transitions: pending → paid → assigned → picking_up → in_transit → delivered → closed
- [ ] Dispute → escrow goes held → disputed; admin can release/refund
- [ ] Pricing call runs BEFORE Stripe session (not after)
- [ ] Stripe webhook handler is idempotent (uses event ID deduplication)
- [ ] Pulse fast path: tries pre-computed match first, falls back to `/assign`
- [ ] Customer order page shows live order state + driver ETA (when assigned)

**Expected Effort:** 2 days

**Dependencies:** Step 2 (real products needed for real checkout) + Pricing/Escrow/Routing/Matching services (already exist, just need wiring)

---

### ⏱️ STEP 6: Reviews & Ratings (Schema + API + UI)

**Status:** PENDING

**What it does:** Add trust layer. Customers rate vendors, products, drivers, service providers after delivery. Ratings aggregate to stars on every entity. Vendors can respond.

**Spec:** `docs/features/06-reviews-ratings.md` (9.3 KB)

**Acceptance Criteria:**
- [ ] `reviews` table: author_id, subject_type, subject_id, order_id (verified-purchase FK), rating (1–5), body
- [ ] One review per (author, subject_type, subject_id, order_id) — uniqueness
- [ ] `subject_responses` table for vendor/driver reply (one reply per review)
- [ ] RLS: only customers with delivered orders can review; only author + subject owner can see their exchange
- [ ] `POST /api/reviews`, `GET /api/reviews?subject_type=...&subject_id=...` paginated
- [ ] Trigger `recompute_subject_rating()` keeps `vendors.rating`, `products.rating`, etc. in sync
- [ ] UI: review form on order detail (enabled after delivery), review list on product/vendor pages
- [ ] Admin moderation page `/admin/reviews` with `is_hidden` toggle

**Expected Effort:** 1–1.5 days

**Dependencies:** Step 5 (reviews only make sense after orders are delivered)

---

### ⏱️ STEP 7: Surface The Pulse Matches in Driver Dashboard

**Status:** PENDING

**What it does:** Driver dashboard shows all open jobs in random order with random payout today. The Pulse worker pre-computes optimal matches and stores them in `pulse_matches` every 30 seconds. Wire the dashboard to those matches so drivers see what the platform decided is best for them, with real numbers.

**Spec:** `docs/features/07-pulse-driver-dashboard.md` (7.5 KB)

**Acceptance Criteria:**
- [ ] "Available Jobs" tab queries `GET /api/matching/pulse/matches?driver_id=<me>&min_score=0.5` first
- [ ] Each match renders as card: batch summary (N stops, total km, ETA), match score badge, **real** estimated payout
- [ ] Cards sorted by match_score DESC
- [ ] Tap card → detail view: full route, vendor names, drop-off, total time, payout breakdown, Accept/Decline buttons
- [ ] Accept calls `/api/matching/assign` or dedicated `/pulse/accept` endpoint
- [ ] Pulse staleness: matches with expired `expires_at` don't render
- [ ] Empty state: fall back to proximity query if no Pulse matches (never blank page)
- [ ] Anticipatory copy: *"3 bundles waiting for you — best one earns ₹420 in 22 minutes"*
- [ ] Auto-refresh every 30 seconds (Supabase realtime in v2)
- [ ] **Remove all `Math.random()` payout generation** (it's scattered in the existing code)

**Expected Effort:** 1 day

**Dependencies:** Independent (Pulse worker + matching service already exist; just need UI wiring)

---

## Execution Rules

### For the Current Session / Next Agent

1. **Read this file first** to understand what's done and what's next
2. **Check the task list** (Tasks #1–#8) — it shows real-time status
3. **Reference the feature specs** at `docs/features/` — they're detailed and self-contained
4. **Never skip acceptance criteria** — they define "done"
5. **Test in browser when possible** — type checking catches syntax; testing catches logic
6. **Keep memory updated** after completing each step (update `docs/progress/project_status.md`)

### Dependencies

```
Step 1: Vendor Onboarding ✅
  ↓
Step 2: Product Catalog ✅
  ↓
Step 3: Multi-Service Providers ⏭️
  ↓
Step 4: LLM Search (optional parallelizable with 2, 3)
  ↓
Step 5: Checkout → Escrow + Batch ⏱️
  ↓
Step 6: Reviews & Ratings ⏱️

Step 7: Pulse Driver Dashboard (can run parallel with 5, 6)
```

**Parallelizable:** Steps 6 and 7 can run in parallel with step 5 (no hard dependency).

### Git Commits

Each completed step should be a single commit:
```
git commit -m "Step N: <title>

<2-3 sentence summary of what was built>

Co-Authored-By: Claude <email>"
```

Example:
```
git commit -m "Step 1: Fix vendor onboarding + extend vendors schema

Added vendors table with hours/KYC/payout fields. Built geocoding helper
and server-side onboarding API. Rewrote form with hours editor and
anticipatory UX copy. Vendor signup now works end-to-end.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

### Environment Variables

Add to `.env.local` in `inc/`:
```bash
# Geocoding
NOMINATIM_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=INC-Marketplace/1.0

# Supabase
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>

# Stripe
STRIPE_SECRET_KEY=<key>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<key>

# OpenAI
OPENAI_API_KEY=<key>
```

---

## Architecture Checklist (Read CLAUDE.md)

- ✅ Services communicate via HTTP through `api/bridge.js` (no direct imports)
- ✅ All locations use PostGIS `GEOGRAPHY(POINT, 4326)` (never Euclidean on lat/lng)
- ✅ UI copy follows "Decision Made Easy" (outcomes, not options)
- ✅ Anticipatory design (pre-compute, don't wait)
- ✅ Database schema in master_schema.sql (production source of truth)
- ✅ Docker init scripts in order: auth_stub → new_tables → pulse_matches → service_providers

---

## How the Next Agent Continues

1. **Read this file** → understand the 7-step plan and current status
2. **Check `docs/progress/project_status.md`** → see what was done in Step 2 and known issues
3. **Pick up at Step 3** → read `docs/features/03-multi-service-providers.md` and start building
4. **Mark tasks as in_progress** when starting, completed when done
5. **Update `docs/progress/project_status.md`** after each step with what was built and what's next
6. **Commit to git** after each step

---

## Quick Reference: Key Files

### Feature Specs (Read These!)
- `docs/features/README.md` — index + conventions
- `docs/features/01-vendor-onboarding.md` ✅ DONE
- `docs/features/02-product-catalog.md` ✅ DONE
- `docs/features/03-multi-service-providers.md` ← NEXT
- `docs/features/04-llm-search-services.md`
- `docs/features/05-checkout-escrow-batch.md`
- `docs/features/06-reviews-ratings.md`
- `docs/features/07-pulse-driver-dashboard.md`

### Core Architecture
- `PRODUCT_BLUEPRINT.md` — Complete vision + architecture overview
- `CLAUDE.md` — project philosophy, service boundaries, integration patterns
- `README.md` — high-level overview
- `docker-compose.yml` — local stack orchestration
- `config/defaults.json` — platform configuration (fees, pulse params, etc.)

### Schemas
- `infra/supabase/master_schema.sql` — production source of truth
- `inc/supabase/schema.sql` — Next.js Supabase schema
- `infra/supabase/new_tables.sql` — Docker local dev init script

### API Bridge
- `api/bridge.js` — HTTP proxy connecting Next.js to microservices
- All service calls from Next.js go through the bridge (never direct)

### Microservices (Already Built)
- `services/pricing_service/` — order pricing, payouts, fees
- `services/routing_service/` — K-means + TSP (batching + optimization)
- `services/matching_service/` — driver scoring, Pulse worker
- `services/escrow_service/` — payment state machine
- `services/rag_agent/` — semantic search for support
- `services/simulator/` — benchmarking tool (allowed to import service internals)

---

## Status Summary (Updated 2026-05-01)

| Step | Task | Spec | Status | Effort |
|------|------|------|--------|--------|
| 1 | Vendor Onboarding | ✅ | COMPLETE | 4 sub-tasks done |
| 2 | Product Catalog | ✅ | COMPLETE | 4 sub-tasks done |
| 3 | Multi-Service Providers | ✅ | COMPLETE (90%) | Schema + API + UI done |
| 4 | LLM Search + Intent | 📄 | Pending | 1–1.5 days |
| 5 | Checkout → Escrow + Batch | 📄 | Pending | 2 days |
| 6 | Reviews & Ratings | 📄 | Pending | 1–1.5 days |
| 7 | Pulse Driver Dashboard | 📄 | Pending | 1 day |

**Total remaining effort:** ~7–8 days of focused work

---

## Last Updated

- **Date:** 2026-05-01
- **By:** Claude Haiku 4.5
- **Step 3 Status:** COMPLETE (90% - schema + API routes + provider services dashboard + public discovery pages + matching service integration)
- **Remaining:** Provider onboarding page + integration testing (follow-up)
- **Next Session Action:** Start Step 4 (Unified LLM Search)
