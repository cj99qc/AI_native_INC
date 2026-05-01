# Spec 06 — Reviews & Ratings (Schema + API + UI)

## Goal

Add a working trust layer: customers can rate vendors, products, drivers, and service providers after a transaction. Ratings aggregate to display stars on every entity. Vendors/providers can respond to reviews.

## Why It Matters

Hyperlocal marketplaces live or die on trust. A new customer in a neighborhood needs to see "4.7★ from 132 reviews" before paying a stranger to fix their pipe. Today the `vendors.rating` and `drivers.rating` columns exist but have no source of truth — they're cosmetic.

## Current State

- **Schema:** `vendors.rating FLOAT` and `drivers.rating FLOAT` exist as plain columns, no underlying review records, no aggregation logic.
- **No reviews table** anywhere in the schema.
- **No review API** routes.
- **No UI** to leave or read reviews.
- Some product card components reference a `rating` value but it's always null/placeholder.

## Acceptance Criteria

- [ ] `reviews` table with: `id`, `author_id` (customer), `subject_type` (`vendor` | `product` | `driver` | `service_provider`), `subject_id`, `order_id` (FK — proves they transacted), `rating` (1–5 int), `body` (text), `is_hidden` (admin moderation), timestamps.
- [ ] Only customers who have a `delivered` order touching the subject can review it (verified-purchase rule).
- [ ] One review per `(author_id, subject_type, subject_id, order_id)` — uniqueness constraint.
- [ ] `subject_responses` table for vendor/provider/driver to reply once per review.
- [ ] `POST /api/reviews` creates a review (RLS-enforced verified-purchase rule).
- [ ] `GET /api/reviews?subject_type=...&subject_id=...&page=...` lists reviews paginated, newest-first.
- [ ] Aggregation: `vendors.rating` / `vendors.review_count` (and same for products/drivers/service_providers) are kept in sync via trigger after INSERT/UPDATE/DELETE on `reviews`.
- [ ] UI: review form on order detail page (only enabled after delivery), review list on product detail page and vendor profile page, star summary in search results.
- [ ] Admin moderation: `/admin/reviews` page lists all reviews with `is_hidden` toggle.

## Files to Touch

- `infra/supabase/master_schema.sql` — `reviews`, `subject_responses`, triggers, RLS.
- `inc/src/app/api/reviews/route.ts` (new) — POST, GET.
- `inc/src/app/api/reviews/[id]/route.ts` (new) — PATCH (for edits or admin hide), DELETE.
- `inc/src/app/api/reviews/[id]/response/route.ts` (new) — vendor/driver response.
- `inc/src/components/ReviewForm.tsx` (new).
- `inc/src/components/ReviewList.tsx` (new).
- `inc/src/components/StarRating.tsx` (new) — read-only and interactive variants.
- `inc/src/app/orders/[id]/page.tsx` — embed review form when status is `delivered`.
- `inc/src/app/product/[id]/page.tsx` — embed review list and aggregate.
- `inc/src/app/vendor/[id]/page.tsx` (new if missing) — vendor public profile with reviews.
- `inc/src/app/admin/reviews/page.tsx` (new) — moderation queue.

## Implementation Outline

1. **Schema + triggers.** Define table + a single trigger function `recompute_subject_rating()` that, on insert/update/delete of `reviews`, recomputes the avg + count on the subject row (`vendors.rating`, `products.rating`, etc.).
2. **Verified-purchase RLS.** Insert policy: `EXISTS (SELECT 1 FROM orders WHERE orders.id = NEW.order_id AND orders.customer_id = auth.uid() AND orders.status = 'delivered' AND <subject is in this order>)`.
3. **API.** Standard CRUD with Zod validation. Star rating must be 1–5 integer.
4. **Components.** `StarRating` — 5 SVG stars, hover state, accessible labels. `ReviewForm` — star + textarea + submit. `ReviewList` — paginated, "show more" button, displays subject_response inline.
5. **Aggregation columns.** Add `review_count INT` to vendors/products/drivers/service_providers. Trigger updates both `rating` (avg) and `review_count`.
6. **Admin moderation.** Admin sets `is_hidden = true`; the trigger should exclude hidden rows from aggregation.

## Schema Changes (SQL)

```sql
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('vendor','product','driver','service_provider')),
  subject_id    UUID NOT NULL,
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          TEXT,
  is_hidden     BOOLEAN NOT NULL DEFAULT false,
  hidden_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (author_id, subject_type, subject_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_subject ON reviews(subject_type, subject_id) WHERE is_hidden = false;
CREATE INDEX IF NOT EXISTS idx_reviews_author  ON reviews(author_id);

CREATE TABLE IF NOT EXISTS subject_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  responder_id UUID NOT NULL REFERENCES auth.users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vendors           ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products          ADD COLUMN IF NOT EXISTS rating       FLOAT;
ALTER TABLE products          ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers           ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE service_providers ADD COLUMN IF NOT EXISTS rating       FLOAT;
ALTER TABLE service_providers ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION recompute_subject_rating()
RETURNS TRIGGER AS $$
DECLARE
  s_type TEXT := COALESCE(NEW.subject_type, OLD.subject_type);
  s_id   UUID := COALESCE(NEW.subject_id,   OLD.subject_id);
  v_avg  FLOAT;
  v_cnt  INTEGER;
BEGIN
  SELECT AVG(rating), COUNT(*) INTO v_avg, v_cnt
  FROM reviews
  WHERE subject_type = s_type AND subject_id = s_id AND is_hidden = false;

  IF s_type = 'vendor' THEN
    UPDATE vendors SET rating = v_avg, review_count = v_cnt WHERE id = s_id;
  ELSIF s_type = 'product' THEN
    UPDATE products SET rating = v_avg, review_count = v_cnt WHERE id = s_id;
  ELSIF s_type = 'driver' THEN
    UPDATE drivers SET rating = v_avg, review_count = v_cnt WHERE id = s_id;
  ELSIF s_type = 'service_provider' THEN
    UPDATE service_providers SET rating = v_avg, review_count = v_cnt WHERE id = s_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reviews_recompute ON reviews;
CREATE TRIGGER trg_reviews_recompute
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION recompute_subject_rating();

-- RLS
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read non-hidden"
  ON reviews FOR SELECT
  USING (is_hidden = false OR auth.uid() = author_id);

CREATE POLICY "Verified purchase insert"
  ON reviews FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_id
        AND o.customer_id = auth.uid()
        AND o.status = 'delivered'
    )
  );

CREATE POLICY "Author can update own"
  ON reviews FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);
```

## Test Plan

1. **Verified purchase.** A customer with no delivered order tries to review a vendor → 403.
2. **Aggregation trigger.** Insert 3 reviews (5, 4, 3) for vendor X → `vendors.rating = 4.0`, `review_count = 3`.
3. **Hidden moderation.** Set `is_hidden=true` on one of those → aggregate recomputes excluding it.
4. **Uniqueness.** Same customer reviews same vendor for same order twice → unique violation.
5. **Response.** Vendor responds to a review → response visible in `GET /api/reviews?subject_id=...`.
6. **UI smoke:** order detail page renders the form only when status is `delivered`. Submitted review appears in vendor profile within a refresh.

## Gotchas

- **`subject_id` is polymorphic.** No FK can enforce its target table; rely on the CHECK constraint on `subject_type` + application-level validation.
- **Trigger performance.** On a high-volume vendor, recomputing an average from scratch on every insert is fine for v1 but won't scale to 100k reviews per vendor. Plan an incremental update path for v2.
- **"Edit your review" loophole.** If you allow edits, a customer can change a 5★ to 1★ months later. Either lock edits after 7 days or show "Edited" badge.
- **Driver privacy on reviews.** Show driver's first name only, not full name, on public driver review pages.
- **What does it mean to review a "service provider" before the work is done?** Tie service-provider reviews to a *completed* service booking record (which is out of scope here — for now, gate it on `orders.status = 'delivered'` if service bookings flow through the orders table, otherwise document this as a v2 gap).

## Out of Scope

- Photo uploads on reviews.
- Helpful/unhelpful voting.
- Review filtering by rating range.
- Auto-moderation via LLM (toxic content detection) — log it as a follow-up.
- Anti-spam rate limiting beyond the verified-purchase rule.
