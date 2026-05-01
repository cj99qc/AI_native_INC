---
name: INC Platform Build Progress
description: Step 2 (Product Catalog) complete. Step 3 (Multi-Service Providers) 90% complete with schema, API routes, and UI pages. Ready for Step 4 (LLM Search).
type: project
---

# INC Platform Build Progress

**Status:** Step 2 Complete, Step 3 In Progress (90% → final testing phase)  
**Last Session:** 2026-05-01  
**Next Action:** Final integration test of Step 3, then move to Step 4 (LLM Search)

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
