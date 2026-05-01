# Spec 03 — Multi-Service Support for Service Providers

## Goal

A real plumber offers 5+ services (leak repair, drain unblocking, tap installation, water heater service, pipe replacement) — each with its own price, duration, and availability. Today our `service_providers` table allows exactly one `service_type` per provider. Replace that with a junction table.

## Why It Matters

The marketplace's value to small tradespeople is letting them showcase their full menu. A "plumber" listing with no priced services is just Yellow Pages — not a marketplace.

## Current State

- **Schema:** `infra/supabase/service_providers.sql` defines `service_providers` with a single `service_type TEXT` column. PostGIS GIST index on `location`. RLS lets active providers be publicly discoverable.
- **API:** `services/matching_service/app.py` exposes `GET /availability?service_type=...&lat=...&lng=...&radius_km=...` — proxies through `api/bridge.js` at `/api/matching/availability`.
- **No UI:** there is no service-provider signup page, no service-listing dashboard, no public service discovery page.
- **No pricing per service.** Customer can't see "leak repair: $80 base + $40/hr".
- **No availability hours.** Customer can't tell if a plumber is reachable now.

## Acceptance Criteria

- [ ] New table `provider_services` with: `id`, `provider_id` (FK to `service_providers`), `service_slug`, `display_name`, `description`, `price_strategy` (enum: `flat` / `hourly` / `quote`), `base_price_cents`, `hourly_rate_cents`, `min_charge_cents`, `estimated_duration_minutes`, `is_active`.
- [ ] `service_providers` keeps its row-per-provider semantics; `service_type` column is **deprecated** (kept for backwards compat for one release, then dropped) — read it as a hint to seed `provider_services`.
- [ ] `GET /api/matching/availability?service=leak_repair&lat=...&lng=...` returns providers who offer that specific service slug, ranked by distance.
- [ ] Provider signup / dashboard at `inc/src/app/provider/services/page.tsx` lets a provider add/edit/delete their services.
- [ ] Provider has hours of operation (same JSONB shape as Spec 01 vendors). Add column `service_providers.hours JSONB`.
- [ ] Public discovery page `inc/src/app/services/[slug]/page.tsx` (e.g., `/services/plumber`) lists providers offering services tagged with that slug, with prices and "open now" badges.
- [ ] A taxonomy table `service_categories` exists, seeded with common services (plumber, electrician, carpenter, painter, cleaner, etc.).

## Files to Touch

- `infra/supabase/service_providers.sql` — add `provider_services`, `service_categories`, `hours`.
- `services/matching_service/app.py` — update `/availability` to JOIN through `provider_services`. Keep the old `service_type` query param as a synonym for `service` for backwards compat.
- `services/matching_service/tests/test_matching.py` — extend tests.
- `api/bridge.js` — no change unless query params shift.
- `inc/src/app/provider/services/page.tsx` (new) — service CRUD for providers.
- `inc/src/app/provider/onboarding/page.tsx` (new or refactor) — provider signup, mirroring vendor onboarding from Spec 01.
- `inc/src/app/services/page.tsx` (new) — top-level service discovery (categories grid).
- `inc/src/app/services/[slug]/page.tsx` (new) — providers list for one service slug.
- `inc/src/app/api/provider/services/route.ts` (new) — CRUD.

## Implementation Outline

1. **Schema migration.** Add `service_categories`, `provider_services`, `service_providers.hours`. Seed `service_categories`.
2. **Backfill.** For each existing row in `service_providers` with non-null `service_type`, insert a corresponding `provider_services` row with `price_strategy='quote'` and a placeholder name. Tag the provider for follow-up.
3. **Matching service update.** `/availability` now does:
   ```sql
   SELECT sp.*, ps.*, ST_Distance(sp.location, point) AS distance_m
   FROM service_providers sp
   JOIN provider_services ps ON ps.provider_id = sp.id
   WHERE ps.service_slug = $1
     AND ps.is_active = true
     AND sp.is_active = true
     AND ST_DWithin(sp.location, point, $radius_m)
   ORDER BY distance_m ASC;
   ```
   Group results by provider, with each provider's matching services as a sub-array.
4. **Provider dashboard.** Form with a list of "service rows" — each row is a `provider_services` entry. Add/remove rows. Save = PATCH all rows.
5. **Public discovery.** `/services` shows category cards. `/services/plumber` shows provider list with: name, distance, rating, list of priced services, "open now" pill, contact button.
6. **Hours-aware "open now".** Compute `is_open_now(hours, timezone)` server-side using the provider's local timezone (store `timezone TEXT` on `service_providers` if not already).

## Schema Changes (SQL)

```sql
CREATE TABLE IF NOT EXISTS service_categories (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  parent_slug TEXT REFERENCES service_categories(slug),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO service_categories (slug, name) VALUES
  ('plumber',     'Plumber'),
  ('electrician', 'Electrician'),
  ('carpenter',   'Carpenter'),
  ('painter',     'Painter'),
  ('cleaner',     'House Cleaner'),
  ('handyman',    'Handyman'),
  ('appliance_repair', 'Appliance Repair'),
  ('hvac',        'HVAC Technician'),
  ('locksmith',   'Locksmith'),
  ('pest_control','Pest Control'),
  ('gardener',    'Gardener / Landscaping'),
  ('mover',       'Mover / Hauling'),
  ('tutor',       'Tutor'),
  ('beautician',  'Beautician / Salon at Home'),
  ('caterer',     'Home Caterer / Baker')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS provider_services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  service_slug    TEXT NOT NULL REFERENCES service_categories(slug),
  display_name    TEXT NOT NULL,
  description     TEXT,
  price_strategy  TEXT NOT NULL CHECK (price_strategy IN ('flat', 'hourly', 'quote')),
  base_price_cents      INTEGER,
  hourly_rate_cents     INTEGER,
  min_charge_cents      INTEGER,
  estimated_duration_minutes INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_services_provider ON provider_services(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_slug     ON provider_services(service_slug);

ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS hours JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- RLS
ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active services"
  ON provider_services FOR SELECT
  USING (is_active = true);

CREATE POLICY "Providers manage own services"
  ON provider_services FOR ALL
  USING (provider_id IN (SELECT id FROM service_providers WHERE user_id = auth.uid()))
  WITH CHECK (provider_id IN (SELECT id FROM service_providers WHERE user_id = auth.uid()));
```

## Test Plan

1. **Unit:** `provider_services` row with `price_strategy='flat'` and null `base_price_cents` should fail a CHECK constraint (add one).
2. **Backfill:** existing `service_providers` rows produce one `provider_services` row each.
3. **API:** `GET /availability?service=leak_repair&lat=18.52&lng=73.85&radius_km=10` returns only providers offering `leak_repair`, ranked by distance.
4. **UI:** as a provider, add 3 services, save, reload — all 3 persist.
5. **Discovery page:** `/services/plumber` shows providers within 20 km, each row showing 1+ services with price.
6. **"Open now":** flip a provider's hours to closed today, verify the badge updates.

## Gotchas

- **Backwards compat.** The `service_providers.service_type` column is read by existing tests. Don't drop it in this PR — keep it, mark deprecated, plan removal in a follow-up.
- **Slug consistency.** `service_categories.slug` and `provider_services.service_slug` must use the same vocabulary. Don't let the dashboard accept free-text slugs — use a dropdown bound to `service_categories`.
- **Pricing strategy + price columns.** A `flat` row needs `base_price_cents`; an `hourly` row needs `hourly_rate_cents`. Either add CHECK constraints or validate at the API layer (recommend both).
- **Time zones.** "Open now" requires the provider's local TZ. Store it. Don't assume server TZ.
- **Cascading deletes.** Deleting a `service_providers` row should cascade to `provider_services`. The FK above does that — confirm in tests.

## Out of Scope

- Booking flow (calendar slots, deposits) — that's a separate spec.
- Service-specific photos/portfolio.
- Reviews per service (Spec 06 covers reviews per provider; per-service granularity is a follow-up).
- LLM intent parsing of "I need a plumber" → service slug — that's Spec 04.
