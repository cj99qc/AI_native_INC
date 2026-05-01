# Spec 05 — Wire Checkout → Escrow + Batch + Driver Match

## Goal

Make `/api/checkout` actually do the marketplace work: hold funds in escrow per vendor, create a delivery batch, hand the batch to the routing service, and let The Pulse pre-match a driver. Today the flow stops at "Stripe took the money."

## Why It Matters

Without this, paid orders sit in the database with no driver, no route, no escrow protection. Vendors don't get paid the right way (no split), customers have no funds protection, and The Handshake principle is broken.

## Current State

- **Endpoint:** `inc/src/app/api/checkout/route.ts` — groups cart items by `vendor_id`, creates one `orders` row per vendor, opens a single Stripe Checkout Session for the bundle.
- **🚨 Missing:** No escrow record is created. No batch row. No driver match request. No delivery address captured.
- **Cart:** `inc/src/app/cart/page.tsx` reads from a `useCart` hook (likely localStorage). No persistent server-side cart.
- **Backend services available but unwired:**
  - `services/pricing_service` `/price` — calculates fees, payouts.
  - `services/escrow_service` `/hold_funds` — DB-persisted state machine.
  - `services/routing_service` `/batch` and `/route` — K-means + TSP.
  - `services/matching_service` `/assign` and Pulse pre-computed matches.
  - All exposed via `api/bridge.js`.

## Acceptance Criteria

- [ ] Checkout collects: delivery address (with map confirm), delivery time window (ASAP / scheduled), special instructions, tip.
- [ ] After Stripe payment success (webhook), the system:
  1. Creates one `escrow_payments` row **per vendor** with the right split (vendor payout, platform fee, driver payout).
  2. Creates one `batches` row containing the multi-vendor pickup-delivery items.
  3. Calls `/api/routing/route` to compute the optimized route through pickups → drop-off.
  4. Triggers driver assignment: tries Pulse pre-computed match first (`/api/matching/pulse/matches`), falls back to `/api/matching/assign`.
  5. Inserts `notifications` rows for vendor (new order) and driver (job offer).
- [ ] Order status transitions: `pending` → `paid` (Stripe confirmed) → `assigned` (driver matched) → `picking_up` → `in_transit` → `delivered` → `closed` (escrow released).
- [ ] On dispute, escrow goes `held` → `disputed`; admin can release or refund via the existing `/api/admin/support/escrow-action` route (already wired — just confirm it works against real escrow rows).
- [ ] Customer order page shows the live state of all the above.
- [ ] Pricing call produces the same numbers Stripe charged — i.e., we **calculate first**, then create the Stripe session with the result, not the other way around.

## Files to Touch

- `inc/src/app/api/checkout/route.ts` — split into "pre-payment" (calculate + create Stripe session) and "post-payment" (webhook handler).
- `inc/src/app/api/checkout/webhook/route.ts` (new) — Stripe webhook handler that triggers the post-payment fan-out.
- `inc/src/app/checkout/page.tsx` — add address picker, time window, instructions, tip.
- `inc/src/lib/checkout/orchestrator.ts` (new) — the post-payment orchestration logic (escrow → batch → route → match).
- `inc/src/lib/bridge.ts` (new or existing) — typed wrapper around the bridge HTTP calls.
- `infra/supabase/master_schema.sql` — extend `orders` with `delivery_lat`, `delivery_lng`, `delivery_address`, `delivery_window_start`, `delivery_window_end`, `customer_instructions`, `tip_cents`. Extend status enum.
- `services/escrow_service/app.py` — confirm `/hold_funds` accepts the per-vendor split shape.

## Implementation Outline

### Phase A — Pre-payment

1. Customer hits `POST /api/checkout` with cart + address + window.
2. Server groups items by vendor.
3. For each vendor group, call `/api/pricing/calculate` with `{items, distance_km, customer_lat, customer_lng}` → returns `{vendor_payout_cents, platform_fee_cents, driver_payout_cents, customer_total_cents}`.
4. Sum customer totals → create one Stripe Checkout Session. Store `intent_metadata` with the vendor-level breakdown so the webhook can reconstruct it.
5. Insert `orders` rows (one per vendor) with `status='pending'` and the pricing breakdown stamped on each.
6. Return Stripe session URL.

### Phase B — Post-payment (webhook)

Stripe webhook `checkout.session.completed`:

1. Mark all `orders` for this session as `paid`.
2. For each vendor's order, call `POST /api/escrow/hold` with `{order_id, vendor_id, customer_id, amount_breakdown}`. Persist the returned `escrow_id` on the order.
3. Create `batches` row: aggregate all pickup points from the session's vendors + the single delivery point. Insert `batch_items`.
4. Call `POST /api/routing/route` with the batch → store `routes` + `route_stops`.
5. Look up Pulse pre-computed match: `GET /api/matching/pulse/matches?batch_id=<new>`. If found and score ≥ threshold, assign that driver. Otherwise call `POST /api/matching/assign`.
6. Update order status → `assigned`. Insert notification rows.

### Phase C — UI updates

- `/checkout` page: add address input (Google Places autocomplete or simple text + geocode call from Spec 01's helper). Time window: "ASAP" toggle or `<select>` of 30-min slots. Tip: $0 / 10% / 15% / 20% / custom.
- `/orders/[id]` page: show order timeline, escrow status pill, driver ETA (when assigned), live route map (when in transit).

## Schema Changes (SQL)

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_location GEOGRAPHY(POINT, 4326),
  ADD COLUMN IF NOT EXISTS delivery_window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_window_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_instructions TEXT,
  ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escrow_id UUID REFERENCES escrow_payments(id),
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id),
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

-- Trigger to compute delivery_location from lat/lng (PostgREST can't call ST_MakePoint directly)
CREATE OR REPLACE FUNCTION compute_order_delivery_location()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.delivery_lat IS NOT NULL AND NEW.delivery_lng IS NOT NULL THEN
    NEW.delivery_location := ST_SetSRID(ST_MakePoint(NEW.delivery_lng, NEW.delivery_lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_delivery_location ON orders;
CREATE TRIGGER trg_orders_delivery_location
  BEFORE INSERT OR UPDATE OF delivery_lat, delivery_lng ON orders
  FOR EACH ROW EXECUTE FUNCTION compute_order_delivery_location();

CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_batch          ON orders(batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_geog  ON orders USING GIST(delivery_location);
```

Status enum (extend existing):
```sql
-- pending → paid → assigned → picking_up → in_transit → delivered → closed
-- + cancelled, disputed
```

## Test Plan

1. **Unit:** orchestrator step-by-step with mocked bridge calls; assert each downstream call gets the right payload.
2. **Stripe mock:** webhook with a fake `checkout.session.completed` event triggers all 5 fan-out steps.
3. **Multi-vendor split:** cart with items from 3 vendors → 3 escrow rows, each with the right `vendor_id` and `amount_vendor_payout_cents`.
4. **Pulse fast path:** seed `pulse_matches` row for the new batch → driver gets assigned in <100 ms (no fresh `/assign` call).
5. **Pulse miss:** with empty `pulse_matches` table, falls through to `/assign`.
6. **End-to-end Playwright:** customer signs up, adds 2 products from 2 vendors, checks out, confirms with Stripe test card, lands on order page, sees driver assigned within 5 s.

## Gotchas

- **Stripe webhook idempotency.** The webhook may fire twice. Use the Stripe event ID as a unique key in a `processed_webhooks` table, skip if already seen.
- **Pricing must precede Stripe session.** If you create the Stripe session with the wrong number, you've already taken the customer's money — refunding partial cents is painful. Always calculate first via the pricing service.
- **Webhook must be idempotent for batch/escrow creation too.** Use `INSERT ... ON CONFLICT (stripe_session_id) DO NOTHING` for batch creation.
- **Don't block the webhook on driver assignment.** Webhook should return 200 in <5 s. Run the Pulse lookup + match assignment in a background task (FastAPI `BackgroundTasks` or a simple queue). The order can be `assigned` later.
- **Cart persistence.** localStorage cart will be lost on a different device. Move cart to a server-side `cart_items` table keyed by `user_id` if not already there. Out-of-scope if you want a thin slice — note as follow-up.
- **Real Stripe vs mock escrow.** Escrow service has `USE_REAL_STRIPE=false` by default. Even in dev, the escrow records are real DB rows. Just don't enable real Stripe Connect transfers without explicit config.
- **Geocoding the delivery address.** Reuse Spec 01's geocode helper. If it fails, block checkout — don't let an order be paid with no delivery point.

## Out of Scope

- Persistent server-side cart (mention as follow-up).
- Live driver tracking on a map (websockets) — order page can poll for v1.
- Multi-currency at checkout — assume single currency per vendor.
- Refund automation triggered by failed delivery — admin still does this manually via the existing escrow-action endpoint.
- Promotions / discount codes.
