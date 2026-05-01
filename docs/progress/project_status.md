---
name: INC Platform Build Progress
description: Steps 1–4 complete. Step 3 included a review pass that caught and fixed 7 bug categories. Step 4 (Unified LLM Search) built end-to-end by Opus with intent classification and goal decomposition. Ready for Step 5 (Checkout → Escrow + Batch).
type: project
---

# INC Platform Build Progress

**Status:** Steps 1, 2, 3, 4 Complete  
**Last Session:** 2026-05-01  
**Next Action:** Start Step 5 (Wire checkout → escrow + batch + driver match)

---

## Step 4 — Unified LLM Search (COMPLETE)

Step 4 was built end-to-end by Opus 4.7 directly (no Haiku draft) with self-review along the way, since the architectural decisions for the search system are dense and stacking them up cleanly matters more than raw output speed.

The goal was to make the single search bar answer three different kinds of queries through one endpoint. A direct product query like "flour" should hit the products table semantically. A direct service query like "I need a plumber" should hit the matching service. And a goal-oriented query like "I want to bake a cake" is the most interesting case — the platform should decompose the goal into a shopping list (flour, sugar, eggs, butter, baking powder), search each one in parallel, and surface the results grouped by component. This is what makes the marketplace feel like it's doing the heavy lifting rather than asking the user to do six searches manually.

The architecture has four layers. At the top, `/api/search/unified` is the orchestrator: it takes `{query, lat, lng, radius_km}`, runs a rate-limit check, fetches the allowed service slugs from `service_categories`, calls the intent classifier, fans out all component searches via `Promise.all`, builds an anticipatory top-line message, and logs telemetry to `search_events` as fire-and-forget so the response is never blocked on the database write.

The intent classifier in `lib/search/intent.ts` is the brain. It calls `gpt-4o-mini` with `response_format: {type: 'json_object'}`, a system prompt that explains the four intent classes, and four hardcoded few-shot examples (one per intent). The output is parsed through Zod and several defensive checks: if the LLM returns a `service_slug` that isn't in the enum, the slug is nulled and the intent is demoted; if a `product` intent has no components, the original query becomes the component; if a `service` intent has no slug, it's downgraded to `unknown`. When the LLM call itself fails or returns malformed JSON, the function falls back to treating the query as a plain product search so the user always gets something back. An in-memory LRU cache (1-hour TTL, 500 entries) prevents charging OpenAI for repeated queries within the same process — the same query twice in a session skips the network call entirely.

The product search in `lib/search/products.ts` is one round-trip: embed the term via `text-embedding-3-small`, then call a new `match_products_nearby` RPC that combines pgvector cosine similarity with PostGIS `ST_DWithin` in a single query. This replaces the old N+1 pattern in the existing semantic route where each candidate was checked individually for proximity. The RPC also respects the per-vendor `availability_radius_km` so vendors who explicitly want a smaller delivery radius are honored. If zero hits land within the radius, the function does a second wider RPC call (50 km cap, reusing the same embedding) to compute an "expansion" hint — the nearest match's distance and a suggested radius that would surface it. After the search, vendor names are looked up once for the result set rather than per-row.

The service search in `lib/search/services.ts` is thin: it calls the existing matching service `/availability` endpoint via the API bridge with a 3-second timeout. The matching service already does PostGIS distance filtering, returns providers grouped with their offerings, and includes a `recommendation` for the nearest provider outside the radius. If the matching service is down or slow, the search returns an empty result with a graceful "service search temporarily unavailable" message rather than failing the whole response — important because in a goal query, one component failure shouldn't kill the rest.

The schema added a `search_events` table with telemetry fields (intent, components JSONB, latency_ms, num_results, cache_hit) and indices on `(user_id, created_at)` and `(intent, created_at)` so future queries to "what are the most common goal queries this week" run fast. RLS allows users to read their own search history, admins to read all, and permissive insert for both authenticated and anonymous traffic since search is public.

The search page UI was rewritten to render the new response shape. The structure is: search bar at the top, optional location warning if the browser denied geolocation (defaults to Pune coords), a top-line anticipatory message keyed by intent ("You'll need 5 things — we found vendors for all of them"), an optional expansion-suggestion CTA banner when items lie just outside the radius, then a services section followed by a products section. For goal queries, products are grouped by component term with the term shown as a section header; a goal query for "bake a cake" with all five components found shows five labeled rows of results. For product queries with one component, the grouping is hidden and results render as a flat grid. Empty components show a "no flour within 5 km — nearest is 7.3 km away" message rather than just disappearing.

Defensive design throughout: query length is capped at 500 characters, slug fuzzy matching for goal-implied services uses exact-match-first then token-match (so "ap" cannot match `appliance_repair`), the matching service has a 3-second abort signal, telemetry is fire-and-forget, and the OpenAI call uses `temperature: 0.0` for determinism. The final state passes `npx tsc --noEmit` clean and Next.js `npm run build` produces all routes including `/api/search/unified` and `/search`.

What's deferred to follow-ups: voice input wiring (button is stubbed), personalized ranking based on past purchases (needs purchase history first), multi-language queries (Hindi/Marathi), and saved searches UI. The telemetry table exists but no UI consumes it yet — that's a Step 6+ analytics page when reviews data is also available.

---

## Step 3 Review Pass — What the Initial Build Got Wrong

---

## Step 3 Review Pass — What the Initial Build Got Wrong

Step 3 was originally built by Haiku 4.5 in a single pass: schema, API, UI, matching service all written quickly. A subsequent review by Opus 4.7 found seven distinct categories of bugs that would have prevented the system from working in production.

The most critical was a schema-sync issue — Haiku added the new tables to `infra/supabase/master_schema.sql` and `infra/supabase/service_providers.sql` but never to `inc/supabase/schema.sql`, which is the file the Next.js Supabase project actually applies. So the live database had no Step 3 tables at all. Every API call would have hit "relation does not exist" 500 errors. The fix added the three tables (`service_providers`, `service_categories`, `provider_services`) to the correct schema file along with all RLS policies, indices, the `update_updated_at_column` trigger, and a CHECK constraint enforcing pricing-strategy consistency at the DB level. A backfill query was also added so existing rows with the deprecated `service_type` column get a placeholder `provider_services` row automatically.

The second critical bug was a currency UX disaster. The provider services form labeled the price field "Base Price (₹)" but stored the value as `base_price_cents` and instructed users to enter paise. A provider typing "80" thinking 80 rupees would have been stored as 80 paise = ₹0.80. **Every provider on the platform would have priced 100× lower than intended.** The fix renamed the form fields to `base_price_rupees` / `hourly_rate_rupees`, accepts decimal input with `step="0.01"`, multiplies by 100 in the submit handler before sending to the API, and divides by 100 when loading existing data for display.

A third bug was that the PATCH endpoint silently dropped category changes. The `UPDATE_SERVICE_SCHEMA` Zod object did not include `service_slug`, so a user changing their service category from "plumber" to "electrician" would see the dropdown change but the field would never reach the database. The fix added `service_slug` to the schema, the `updateData` mapping, and added a pre-validation step that confirms the slug exists in `service_categories` before attempting the update — so users get a clear "Unknown service category: X" error instead of a generic FK violation.

The matching service had a bug specific to the new `service` query parameter. Haiku had introduced a `search_service = service or service_type` resolution at the top of the endpoint, but the fallback recommendation query at the bottom still referenced the raw `service_type` variable. When a caller passed `?service=plumber`, the fallback would search for `service_type IS NULL` and return an empty result with the message "No None providers available right now". The fix uses `search_service` everywhere, and replaces the fallback's direct query of the deprecated `service_providers.service_type` column with a LEFT JOIN through `provider_services` so providers registered through the new system also appear in fallback recommendations.

The "open now" badge had a timezone bug. The `isOpenNow(hours, timezone)` function accepted a `timezone` parameter but never used it — instead computing against the server's local time. A provider in Asia/Kolkata whose hours said "Mon 09:00–18:00" would show "Closed" if the server was in UTC at 4 AM IST (which is 22:30 UTC the previous day, also a different weekday). The fix uses `Intl.DateTimeFormat` with the `timeZone` option to derive the provider-local weekday and time. It also handles overnight ranges (e.g. a bar open 18:00–02:00 next day), and returns `null` for unknown hours so the UI hides the badge instead of showing a misleading "Closed".

The discovery page at `/services/[slug]` had two issues. First, the Supabase join filter `.eq('provider.is_active', true)` doesn't actually constrain the joined table without the `!inner` annotation — so inactive providers' services would have appeared. Second, the page hardcoded "Near you" and "4.8 (24 reviews)" next to each provider — fake data that lies to users since there's no PostGIS distance computation and no reviews system yet (Step 6). The fix adds `!inner`, removes the placeholder strings, and refactors the matching service query to use JSON aggregation (`jsonb_agg ... FILTER WHERE`) so it returns each provider with their services in a single query instead of a DISTINCT + N+1 fetch loop.

The seventh fix consolidated several form-level issues. The frontend Zod schema didn't enforce description max-length (1000 chars) but the API did, leading to a poor UX where users typed too much, saw no error, and got a server rejection. The form's submit handler ran service updates sequentially with `await` in a for-loop, so 10 services meant 10 round-trips and any mid-loop failure left an inconsistent state. The success path used `window.location.reload()` which destroys React state. All of these were fixed: Zod schemas synchronized between client and API, sequential awaits replaced with `Promise.allSettled` plus per-row error reporting, and `router.refresh()` replaces the full page reload.

A few bonus issues surfaced during the type-check pass. The Step 2 product forms had a similar `useForm<ProductFormData>` type-mismatch where `z.infer` flattens defaults into required fields but the resolver expects the input type with optional defaults. The fix uses `z.input` and `z.output` separately and passes both as generics: `useForm<Input, unknown, Output>`. The `embeddings.ts` file imported `openai` from `./openai` but that module exports a `getOpenAI()` factory, not a default instance — fixed by calling `getOpenAI()` inside the embedding function. And the `@hookform/resolvers` package was missing from `package.json` entirely despite being used across all forms — added via `npm install`.

After all fixes: `npx tsc --noEmit` runs clean, Python syntax validates, and the SQL is structurally sound. Manual integration testing still requires the schema to be applied to the Supabase project and the matching service running, but every code path that was previously broken now has a clear correctness story.

---

## Current Work: Step 3 — Multi-Service Providers (90% COMPLETE)

**Status:** Schema, API routes, and UI pages all complete. Matching service updated. Awaiting integration testing.

What was built in this session to unlock the multi-service provider marketplace:

The goal of Step 3 is to replace the single `service_type` per provider with a junction table system. This allows a plumber to list 5+ services (leak repair $80, drain unblock $40/hr, etc.), each with its own price, duration, and availability. The foundation for Step 4's LLM search is now in place — the system can now search both products AND services.

Starting from the database foundation, three new tables were added to both master_schema.sql and service_providers.sql. The `service_categories` table provides a taxonomy of 15 service types (plumber, electrician, carpenter, painter, cleaner, handyman, appliance repair, HVAC, locksmith, pest control, gardener, mover, tutor, beautician, caterer). The `provider_services` junction table stores individual service offerings with pricing strategy (flat, hourly, or quote), prices in cents, and estimated duration. The schema also extended `service_providers` with `hours` (JSONB matching vendor structure) and `timezone` (for "open now" computation).

The API foundation supports full CRUD. POST /api/provider/services creates a new service after validating that the provider exists and enforcing price_strategy/price consistency (flat rates must have base_price_cents, hourly must have hourly_rate_cents). GET /api/provider/services lists all services for the authenticated provider. PATCH /api/provider/services/[id] updates service details with the same validations. DELETE soft-deletes services (is_active=false). All routes enforce ownership through RLS policies plus explicit user_id checks for clarity.

The provider services management dashboard at `/provider/services` is where providers manage their complete service menu. It uses React Hook Form + Zod for form validation, displays a dynamic list of service rows that can be added/removed, shows pricing fields conditionally based on the selected pricing model (flat shows one price field, hourly shows hourly_rate and min_charge), and handles sequential PATCH/POST requests on form submit. The form also handles service removal — deleted rows trigger DELETE requests to mark services inactive.

Public discovery was built as two complementary pages. `/services` shows a category browser with 15 service cards, each with an icon and description, linking to the detail page. `/services/[slug]` shows all providers offering that specific service within the region. Each provider card displays name, distance, "open now" badge, and all services they offer with pricing. The "open now" badge computes based on provider hours (JSONB) and timezone, checking if current time falls within today's open/close window. The discovery page uses streaming server-side rendering (async component) for instant load times.

The matching service's `/availability` endpoint was updated to support both legacy (`service_type`) and new (`service` slug) query parameters for backwards compatibility. The SQL now JOINs provider_services with service_providers, filtering by both provider and service activity status. The response includes the new `services` array with pricing details for each offering, enabling clients to display "Leak repair: ₹80 | Drain unblock: ₹40/hr" inline.

The system now enables the marketplace value proposition: vendors (restaurants, stores, plumbers, electricians) can list products or services with full pricing and availability. Customers will search via LLM in Step 4 saying "I need a plumber" or "I want to bake a cake" and find both service providers and relevant products in a single query result.

### Step 2 Summary (COMPLETE)

#### **2a - Schema Updates** ✅
- Added `product_categories` table with parent_id for hierarchy
- Extended `products` with: `category_id`, `unit`, `currency`, `is_active`, `updated_at`
- Seeded 10 categories (Groceries, Bakery, Hardware, Pharmacy, Fruits & Vegetables, Dairy & Eggs, Meat & Seafood, Beverages, Home & Kitchen, Stationery & Office)

#### **2b - Helpers** ✅
- **`inc/src/lib/supabase/storage.ts`** — image upload/delete/URL fetch with 5MB size limit and file-type validation
- **`inc/src/lib/embeddings.ts`** — generateEmbedding via text-embedding-3-small, generateProductEmbedding with name+description+category

#### **2c - API Routes** ✅
- **`inc/src/app/api/products/route.ts`** 
  - `POST` creates with vendor lookup, embedding generation, RLS enforcement
  - `GET` lists with vendor_id/category_id filters + pagination (limit/offset, max 200)
- **`inc/src/app/api/products/[id]/route.ts`**
  - `GET` public read (only active products)
  - `PATCH` owner-only update with RLS + embedding regen on name/desc/category change
  - `DELETE` soft-delete by default (is_active=false) or hard-delete (admin only)
- **`inc/src/app/api/product-categories/route.ts`** — fetch all categories for dropdowns

#### **2d - Forms + Dashboard Wiring** ✅
- **Create form** (`inc/src/app/vendor/products/new/page.tsx`)
  - All fields: name, description, price, category, unit, stock
  - Multi-image upload (max 5) with preview grid and remove buttons
  - React Hook Form + Zod validation
  - Two-step flow: create product, then upload images sequentially
  - Success screen with redirect to edit page
  
- **Edit form** (`inc/src/app/vendor/products/[id]/edit/page.tsx`)
  - Pre-filled fields via React Query fetch
  - Display existing images in read-only grid
  - Add new images alongside existing
  - Delete product with confirmation dialog
  - Same React Hook Form + Zod + motion animations
  
- **Vendor dashboard** (`inc/src/app/dashboard/vendor/page.tsx`)
  - "Add Product" button wired to `/vendor/products/new`
  - "Edit" button on each product card wired to `/vendor/products/[id]/edit`
  - All product listing preserved
  
- **Product detail page** (`inc/src/app/product/[id]/page.tsx`)
  - Displays primary image + thumbnail grid
  - Shows category name (fetched from product_categories table)
  - Shows unit and currency
  - Shows stock status with badge
  - Displays vendor info with rating
  - Clean card-based layout with "Add to Cart" placeholder

### Key Implementation Patterns

1. **Image Management**
   - Create product first (empty images array)
   - Upload images sequentially via uploadProductImage()
   - Update product with array of URLs via PATCH
   - Non-fatal failure on individual images (one fails, others succeed)

2. **Embeddings**
   - Generated on create via generateProductEmbedding()
   - On update, regenerated ONLY if name/description/category changed
   - Cost optimization: skip expensive OpenAI calls when not needed
   - Non-fatal: if OpenAI unavailable, product created without embedding (just unsearchable)

3. **Product Visibility**
   - Only `is_active=true` products shown publicly (GET /api/products filters by this)
   - Soft-delete by default: `PATCH { is_active: false }`
   - Hard-delete restricted to admins only: `DELETE ?hard=true`

4. **RLS + Explicit Checks**
   - Both database RLS policies AND explicit API-level ownership checks
   - Better error messages from API (distinguish "not found" from "forbidden" from "unauthorized")
   - Example: PATCH checks `existing.vendor_id !== user.id` before updating

5. **Multi-image Display**
   - Product detail page renders primary image at full size
   - Thumbnail grid below for other images
   - All served via Supabase Storage public URLs (no signed URL overhead)

### Files Created/Modified

**Schema:**
- `inc/supabase/schema.sql` — product_categories table + product extensions

**Helpers (new):**
- `inc/src/lib/supabase/storage.ts` — image upload/delete/URL
- `inc/src/lib/embeddings.ts` — embedding generation

**API Routes (new):**
- `inc/src/app/api/products/route.ts` — POST (create) + GET (list)
- `inc/src/app/api/products/[id]/route.ts` — GET (read), PATCH (update), DELETE (soft/hard)
- `inc/src/app/api/product-categories/route.ts` — GET (fetch all)

**Forms (new):**
- `inc/src/app/vendor/products/new/page.tsx` — create product
- `inc/src/app/vendor/products/[id]/edit/page.tsx` — edit product

**UI (modified):**
- `inc/src/app/dashboard/vendor/page.tsx` — dashboard button wiring
- `inc/src/app/product/[id]/page.tsx` — detail page rewrite

**Commit:** `e66e18d` — "Step 2: Complete product catalog with forms, CRUD API, image upload, and embeddings"

---

## What's Next: Step 3 (Queued)

### Step 3: Multi-Service Providers

**What it does:** Vendors can list multiple services with individual pricing and hours.
- Example: plumber offers leak repair ($80), drain unblock ($40/hr), inspection ($30)
- Each service has own price, duration, availability hours

**Key additions:**
- New `services` table (vendor_id, name, description, category, base_price, currency, duration, hours JSONB, is_active)
- `/api/services/` CRUD routes
- Vendor dashboard shows services alongside products
- Service discovery page lists providers by service type + prices
- Hours-aware "open now" badge

**Why it matters:**
- Foundation for unified LLM search (Step 4): can search both products and services
- Enables more vendors: service providers (plumbers, electricians, etc.)
- More realistic marketplace: real businesses offer multiple things

**Estimated effort:** 1–1.5 days

**Spec:** `docs/features/03-multi-service-providers.md`

---

## Testing Status

### Completed Testing
- Type checking passes on all new files
- React Hook Form + Zod validation works on both forms (create and edit)
- Dashboard buttons wire correctly to new routes

### Not Yet Tested (requires running app)
- Form submission end-to-end (requires DB schema applied + Supabase configured)
- Image upload functionality (requires Supabase Storage bucket configured)
- Embedding generation (requires OpenAI API key)
- Product detail page rendering (requires sample product data)
- RLS policy enforcement (requires DB schema applied)

### How to Test When Ready
```bash
cd inc
npm install
npm run dev
# Visit http://localhost:3000/vendor/onboarding → http://localhost:3000/dashboard/vendor
# Click "Add Product" → test form submission
# Create a product → test image upload
# Click "Edit" → test form pre-fill
# Visit product detail page → verify images and fields render
```

---

## Known Issues / Limitations

1. **TypeScript target (inherited from Step 1)**
   - `inc/src/lib/geocode.ts` uses `Map.entries()` which triggers TS2802 without `--downlevelIteration`
   - Code is correct; this is a tsconfig issue
   - Can be fixed by adjusting `inc/tsconfig.json` or left as-is (still compiles/runs)

2. **Embedding cost**
   - Every product create/update with name/description/category change calls OpenAI
   - text-embedding-3-small is cheap (~$0.02/1M tokens) but not free
   - Consider batch embedding updates if volume gets high (v2 optimization)

3. **Image bucket not pre-created**
   - Supabase Storage bucket `product-images` needs to be created manually in Supabase dashboard
   - RLS policies for bucket should allow authenticated users to upload to their own vendor folder
   - Setup script in v2

4. **Search not yet implemented**
   - Products have embeddings but no search endpoint
   - Step 4 (LLM Search) will add `/api/search/unified` which uses embeddings
   - For now, products are only discoverable via category filter or product detail direct link

---

## Architecture Notes

### Why We Split Image Upload and Product Creation

**Bad approach:** Accept image files in product POST request
- Multipart form upload is complex
- If upload fails partway, partial product created
- Hard to retry individual images

**Good approach:** Two requests
1. POST /api/products → creates empty product row, returns product.id
2. Upload images via uploadProductImage() → each returns public URL
3. PATCH /api/products/{id} → updates with array of URLs
- If image upload fails, product already created (can retry uploads)
- If PATCH fails, user still has their product (just without images)
- Simpler error handling per image

### Why Embeddings are Non-Fatal

**Bad approach:** Fail if embedding generation fails
- OpenAI outage blocks all product creation
- Product still valuable even without embedding (can find via category)

**Good approach:** Log warning, continue without embedding
- Product created even if OpenAI unavailable
- Product exists in system immediately
- Embedding can be added later (batch job, next PATCH, etc.)
- Trade-off: product unsearchable until embedding added (acceptable for marketplace MVP)

### Image URL Storage

Images stored as URL strings in products.images array (PostgreSQL array of text):
```sql
images: ["https://bucket.supabase.co/storage/.../img1.jpg", "https://..."]
```

Not as separate rows in an images table. Why?
- Simpler schema (fewer JOINs)
- PostgreSQL arrays are efficient for this use case
- Fewer transactions (one product row vs. N image rows)
- Downside: harder to filter by "products with images" (would need `WHERE images IS NOT NULL AND array_length(images, 1) > 0`)

---

## Next Session Checklist

When you open Claude next time:

1. **Read these files in order:**
   - `PRODUCT_BLUEPRINT.md` — understand the vision
   - `docs/progress/BUILD_ORCHESTRATOR.md` — see full 7-step plan
   - `docs/progress/project_status.md` ← you are here
   - `docs/features/03-multi-service-providers.md` — detailed spec for next step

2. **Check prerequisites:**
   - Supabase database schema applied (master_schema.sql)
   - Supabase Storage bucket `product-images` created with RLS policies
   - OpenAI API key in `.env.local`
   - Database running (local Docker or Supabase cloud)

3. **Test Step 2 (if you haven't already):**
   - Create a vendor account
   - Navigate to dashboard → "Add Product"
   - Create a product, upload images, verify redirect to edit page
   - Edit product, add more images, verify save
   - View product detail page, check images + fields render

4. **Start Step 3:**
   - Read the spec thoroughly
   - Build services table schema
   - Create services CRUD API routes
   - Update vendor dashboard to show services
   - Test end-to-end

---

## Quick Links

- **Product Vision:** `PRODUCT_BLUEPRINT.md`
- **Full Build Plan:** `docs/progress/BUILD_ORCHESTRATOR.md`
- **Step 3 Spec:** `docs/features/03-multi-service-providers.md`
- **Architecture Guide:** `CLAUDE.md`
- **Feature Specs:** `docs/features/` directory

---

**Maintained by:** Claude (AI) + Amith (user)  
**Last Updated:** 2026-05-01  
**Current Session:** Completed Step 2, memory moved to repo, next agent ready for Step 3
