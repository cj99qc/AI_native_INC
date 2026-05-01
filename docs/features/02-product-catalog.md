# Spec 02 — Product Catalog (Create / Edit / Image Upload)

## Goal

Let vendors actually list products. Build the create-product form, the API behind it, image upload to Supabase Storage, and a category taxonomy. Without this, the search bar in Spec 04 has nothing to find.

## Why It Matters

Today the vendor dashboard has an "Add Product" button that goes nowhere. The `products` table exists in schema but no row is ever inserted by the app. Customers searching "flour" get an empty page even if 50 bakeries are signed up.

## Current State

- **Schema:** `inc/supabase/schema.sql` defines `products` with `name`, `description`, `price`, `stock`, `images TEXT[]`, `vendor_id`, `embedding vector(1536)`. Verify before editing.
- **UI:** `inc/src/app/dashboard/vendor/page.tsx` shows a product grid (read-only). No form, no edit page.
- **No API:** no `POST /api/products`, no `PATCH /api/products/[id]`.
- **No image upload:** the `images` column type exists but no upload flow, no storage bucket configured.
- **No category taxonomy:** no `category` column, no enum, no parent/child structure.

## Acceptance Criteria

- [ ] `POST /api/products` creates a product owned by the current user's vendor row. RLS enforces that a vendor can only create products under their own vendor_id.
- [ ] `PATCH /api/products/[id]` and `DELETE /api/products/[id]` work with the same RLS guarantee.
- [ ] `inc/src/app/vendor/products/new/page.tsx` form: name, description, price, stock, category, up to 5 images.
- [ ] `inc/src/app/vendor/products/[id]/edit/page.tsx` form: same fields, pre-filled.
- [ ] Images upload to Supabase Storage bucket `product-images`, return signed URLs stored in `products.images`.
- [ ] Categories live in a `product_categories` table seeded with a starter set (Groceries, Bakery, Hardware, Pharmacy, etc. — see seed list below).
- [ ] Vendor dashboard "Add Product" button links to `/vendor/products/new`.
- [ ] Vendor dashboard product card "Edit" button links to `/vendor/products/[id]/edit`.
- [ ] Product detail page (`inc/src/app/product/[id]/page.tsx`) renders the new fields and images.
- [ ] On product create/update, the embedding is generated from `name + description + category` via OpenAI `text-embedding-3-small` and stored in `products.embedding` so semantic search works.

## Files to Touch

- `inc/src/app/api/products/route.ts` (new) — POST list endpoint.
- `inc/src/app/api/products/[id]/route.ts` (new) — GET / PATCH / DELETE.
- `inc/src/app/vendor/products/new/page.tsx` (new) — create form.
- `inc/src/app/vendor/products/[id]/edit/page.tsx` (new) — edit form.
- `inc/src/app/dashboard/vendor/page.tsx` — wire "Add Product" + "Edit" buttons.
- `inc/src/app/product/[id]/page.tsx` — render new fields.
- `inc/src/lib/supabase/storage.ts` (new) — image upload helper.
- `inc/src/lib/embeddings.ts` (new or existing) — generate embedding for a product.
- `infra/supabase/master_schema.sql` — extend `products` + add `product_categories` table.
- `infra/docker/01_new_tables.sql` — mirror.

## Implementation Outline

1. **Schema changes.** Add `category_id`, `unit` (e.g., "kg", "each", "litre"), `currency` (default `INR` or `CAD` — pick per market), `is_active`. Create `product_categories` (id, slug, name, parent_id). Seed it.
2. **Storage bucket.** In Supabase, create `product-images` bucket. Set RLS: vendors can write to a folder named `<vendor_id>/<product_id>/`; everyone can read. Document the policy SQL in this spec, run as part of `master_schema.sql` if possible.
3. **API routes.**
   - `POST /api/products` — Zod validate, look up `vendor_id` from session, insert row, generate embedding, return.
   - `GET /api/products/[id]` — public read.
   - `PATCH /api/products/[id]` — owner only (RLS), regenerate embedding if name/description/category changed.
   - `DELETE /api/products/[id]` — soft delete (set `is_active=false`) by default; hard delete only if `?hard=true` and admin role.
4. **Image upload.** `inc/src/lib/supabase/storage.ts` — `uploadProductImage(file, vendorId, productId)`. Use `supabase.storage.from('product-images').upload(...)`. Return public URL.
5. **Forms.** Standard React Hook Form + Zod. The image picker accepts up to 5 files, shows previews, uploads on submit (don't upload before the product row exists — pass `productId` from the create response into a follow-up upload step, or use a temp folder and move).
6. **Embeddings.** `generateProductEmbedding({name, description, category})` calls OpenAI, returns 1536-dim vector. Insert/update via Supabase RPC since vectors aren't directly supported in PostgREST `update()` for some clients — verify what works.
7. **Wire dashboard.** Replace placeholder buttons with `Link` components.

## Schema Changes (SQL)

```sql
CREATE TABLE IF NOT EXISTS product_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  parent_id    UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit         TEXT NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS currency     TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);
```

Seed:
```sql
INSERT INTO product_categories (slug, name) VALUES
  ('groceries', 'Groceries'),
  ('bakery',    'Bakery & Confectionery'),
  ('hardware',  'Hardware & Tools'),
  ('pharmacy',  'Pharmacy & Health'),
  ('produce',   'Fruits & Vegetables'),
  ('dairy',     'Dairy & Eggs'),
  ('meat',      'Meat & Seafood'),
  ('beverages', 'Beverages'),
  ('home',      'Home & Kitchen'),
  ('stationery','Stationery & Office')
ON CONFLICT (slug) DO NOTHING;
```

## Test Plan

1. **Unit:** Zod rejects negative price, stock < 0, more than 5 images.
2. **Integration:** create a product as vendor A, attempt to edit as vendor B — should 403.
3. **Storage:** upload a 2 MB JPEG, verify public URL renders in browser.
4. **Embedding:** create a product "Whole wheat flour 1kg", verify `products.embedding` is non-null and ~1536 floats.
5. **Search smoke test:** new product should be findable in Spec 04's search once that lands.

## Gotchas

- **Vector column writes.** Supabase JS client may not handle `vector` type natively; you may need to call a Postgres RPC `set_product_embedding(product_id, embedding)` instead of plain `update()`.
- **Image upload race.** Don't try to upload images before the product row exists (you don't have an ID for the folder name). Either: (a) create row first, then upload, or (b) upload to a temp folder and move on save.
- **RLS for the bucket.** Use `auth.uid()` in the storage policy to gate writes by the vendor's `user_id`. Reads are public.
- **Embedding cost.** Don't regenerate the embedding on every PATCH — only when name/description/category actually change. Diff the incoming payload against the current row.
- **Currency.** Pick the right default for your market. The schema stores per-row so multi-region is possible later.

## Out of Scope

- Product variants (size, color, SKU). Add a `product_variants` table in a follow-up.
- Inventory forecasting / low-stock alerts.
- Bulk CSV import.
- Sponsored placements (already a separate page in the dashboard, not touched here).
- Product reviews — that's Spec 06.
