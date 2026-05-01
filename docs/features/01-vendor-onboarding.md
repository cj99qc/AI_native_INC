# Spec 01 — Vendor Onboarding (Fix + Extend)

## Goal

Make vendor signup actually work, and capture the data the marketplace needs from a real small business: location (geocoded), business hours, KYC, payout details.

## Why It Matters

A hyperlocal marketplace is worthless without vendors. Today the signup form posts to a table that doesn't exist — so no real vendor can register. Every other feature (product catalog, search, checkout) is blocked behind this.

## Current State

- **UI exists:** `inc/src/app/vendor/onboarding/page.tsx` — full multi-step form (business type, contact info, address).
- **🚨 BUG:** the form inserts into a `businesses` table that does not exist. The actual table is `vendors`.
- **Schema:** `infra/supabase/master_schema.sql` defines `vendors` with: `id`, `user_id` (FK to `auth.users`), `business_name`, `category`, `location` (GEOGRAPHY POINT 4326), `is_active`, `rating`, `phone`, `email`, KYC placeholder fields. Verify exact columns before editing.
- **No geolocation step** — the form collects a typed address but never converts it to lat/lng, so `location` stays NULL and the vendor will never appear in geospatial search.
- **No hours of operation, no payout setup, no document upload.**

## Acceptance Criteria

- [ ] Vendor signup form writes to the `vendors` table successfully (no more `businesses` typo).
- [ ] On submit, the typed address is geocoded → `location` GEOGRAPHY column is populated.
- [ ] Form collects business hours (per weekday: open / closed + open_time + close_time).
- [ ] Form collects payout method placeholder (Stripe Connect link or manual bank fields gated by feature flag).
- [ ] Form collects at least one KYC field (business license number OR tax ID).
- [ ] After successful submit, the user's `profiles.role` is set to `vendor`.
- [ ] Vendor appears in `/admin/dashboard` vendor list immediately after signup.
- [ ] Existing vendors who already signed up via the broken flow are not corrupted (write a one-time migration if needed).

## Files to Touch

- `inc/src/app/vendor/onboarding/page.tsx` — repoint to `vendors`, add new fields.
- `inc/src/app/api/vendor/onboarding/route.ts` (new) — server route that does the geocoding + insert (don't put service-role keys in the client).
- `infra/supabase/master_schema.sql` — extend `vendors` with `hours JSONB`, `kyc_business_license TEXT`, `kyc_tax_id TEXT`, `payout_method TEXT`, `stripe_connect_id TEXT`, `onboarding_status TEXT` (`pending` / `approved` / `rejected`).
- `infra/docker/01_new_tables.sql` — mirror schema additions if used for local dev.
- `inc/src/lib/geocode.ts` (new) — small wrapper around a geocoding API (OpenStreetMap Nominatim is free and acceptable for v1).

## Implementation Outline

1. **Schema migration.** Add columns to `vendors`. Use `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` so it's idempotent.
2. **Server route.** Create `POST /api/vendor/onboarding` that:
   - Validates input with Zod.
   - Geocodes the address → `lat`, `lng`.
   - Inserts into `vendors` with `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography` for `location`.
   - Updates `profiles.role = 'vendor'` for the calling user.
   - Returns the new vendor row.
3. **Client form.** Repoint the existing form's submit handler to `POST /api/vendor/onboarding`. Add new fields:
   - Hours editor: 7-row table, each row has open/closed toggle + two time pickers.
   - KYC: business license number, tax ID (text inputs, no file upload yet — that's a follow-up).
   - Payout method: dropdown (`stripe_connect` / `manual_bank`), only stripe_connect is wired up for now (manual_bank stores raw text fields gated by `ENABLE_MANUAL_PAYOUT=true`).
4. **Geocoding helper.** `inc/src/lib/geocode.ts` — function `geocode(address: string): Promise<{lat:number, lng:number}>`. Use Nominatim with proper User-Agent header per their policy. Cache results by address hash to avoid hammering the API.
5. **Migration of existing data.** If any rows landed in a `businesses` table, write a one-time script to copy them to `vendors`. If the table was never created, this is a no-op.

## Schema Changes (SQL)

```sql
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS hours JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS kyc_business_license TEXT,
  ADD COLUMN IF NOT EXISTS kyc_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_method TEXT CHECK (payout_method IN ('stripe_connect', 'manual_bank')),
  ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (onboarding_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_vendors_onboarding_status ON vendors(onboarding_status);
```

`hours` shape:
```json
{
  "mon": {"open": "09:00", "close": "17:00", "closed": false},
  "tue": {...}, "wed": {...}, "thu": {...}, "fri": {...},
  "sat": {"closed": true}, "sun": {"closed": true}
}
```

## Test Plan

1. **Unit:** Zod schema validation rejects malformed hours JSON, missing required fields.
2. **Integration:** sign up a fresh user, complete the form, verify a row exists in `vendors` with `location` set to a non-null point and `profiles.role = 'vendor'`.
3. **Geospatial sanity:** run `SELECT ST_AsText(location) FROM vendors WHERE id = '<new>';` — should return `POINT(<lng> <lat>)`.
4. **Admin visibility:** the new vendor should show up in `/admin/dashboard` vendor list.
5. **Idempotency:** re-running the schema migration on a populated DB should not error or duplicate columns.

## Gotchas

- **Service-role key.** Don't expose Supabase service role on the client. Geocoding + insert must happen in a server route.
- **PostGIS literal.** PostgREST cannot call `ST_MakePoint` directly. Either use a server route with raw SQL via Supabase RPC, or insert lat/lng as separate columns and use a trigger to compute the GEOGRAPHY (the same pattern `compute_ticket_location()` uses for support tickets — see `CLAUDE.md`).
- **Nominatim rate limit.** 1 request/second. Cache aggressively. Set a meaningful User-Agent (e.g., `INC-Marketplace/1.0`).
- **Role escalation.** Setting `profiles.role = 'vendor'` is a privileged change. Make sure RLS allows it only when the user is updating their own row, or do it server-side with the service-role key.
- **Existing vendors.** Some vendor rows may exist already from earlier testing. Don't blindly overwrite — use `INSERT ... ON CONFLICT (user_id) DO UPDATE`.

## Out of Scope

- Document upload for KYC (license PDFs, tax forms) — comes in Phase 2 of onboarding.
- Stripe Connect actual account creation flow — store `stripe_connect_id` field but don't wire the OAuth handshake yet.
- Vendor approval workflow (manual review queue) — `onboarding_status` defaults to `pending` but admin approval UI is not part of this PR.
- Hours-aware availability ("vendor closed now") — schema lands here, runtime check lands in Spec 04.
