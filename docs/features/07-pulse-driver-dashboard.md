# Spec 07 — Surface The Pulse Matches in Driver Dashboard

## Goal

The driver dashboard today shows ALL open jobs in random order with a randomly-generated payout. The matching service already pre-computes optimal driver-batch matches via The Pulse and stores them in `pulse_matches`. Wire the dashboard to those matches so drivers see what the platform decided is best for them, with real numbers.

## Why It Matters

The Pulse is the platform's headline feature — autonomous, anticipatory matching. It runs every 30 seconds, computes the best matches, and writes them to a table. Then the driver opens the dashboard and... sees a generic job list. The whole "Decision Made Easy / We anticipated this for you" promise is invisible to the driver.

## Current State

- **Worker:** `services/matching_service/pulse_worker.py` runs every 30 s, scans active drivers + pending batches, computes scores, stores in `pulse_matches` (with `expires_at`).
- **Bridge endpoint:** `GET /api/matching/pulse/matches` (proxies to matching service `/pulse/matches`).
- **Driver dashboard:** `inc/src/app/driver/dashboard/page.tsx`:
  - Available Jobs tab queries `delivery_jobs` directly with no proximity filter.
  - Estimated payout is `Math.random()` (literally) — see the existing `acceptJob()` flow.
  - No batch view — driver sees individual jobs not optimized routes.
- **Pulse table:** `infra/supabase/pulse_matches.sql` defines `pulse_matches(driver_id, batch_id, match_score, expires_at, ...)`.

## Acceptance Criteria

- [ ] Driver dashboard's "Available Jobs" tab queries `GET /api/matching/pulse/matches?driver_id=<me>&min_score=0.5` first.
- [ ] Each Pulse match renders as a card showing: batch summary (N stops, total km, ETA), score (as "98% match" or "best-match" badge), real estimated payout (sum from `orders.driver_payout_cents` for the batch's orders).
- [ ] Cards are sorted by `match_score DESC`.
- [ ] Tapping a card opens a detail view: full route stops, vendor names, customer drop-off, total time, exact payout. Two buttons: **Accept Bundle** (assigns the whole batch) and **Decline**.
- [ ] Accept calls `POST /api/matching/assign` (or a dedicated `/pulse/accept` endpoint) → batch is locked to this driver, other drivers' Pulse matches for the same batch are invalidated.
- [ ] Pulse staleness: if a match's `expires_at` is in the past, the worker has cleaned it up and we display nothing for it. UI should auto-refresh every 30 s.
- [ ] **Empty state:** if no Pulse matches exist for the driver, fall back to a basic proximity query of unassigned batches within 10 km — never show a blank page.
- [ ] An "anticipatory" copy line is shown: *"3 bundles waiting for you — best one earns ₹420 in 22 minutes."*

## Files to Touch

- `inc/src/app/driver/dashboard/page.tsx` — replace the available-jobs fetch + card rendering.
- `inc/src/app/api/driver/pulse-jobs/route.ts` (new) — server route that calls the bridge and merges in vendor names / addresses (the bridge response gives IDs only).
- `inc/src/components/driver/PulseJobCard.tsx` (new).
- `inc/src/components/driver/PulseJobDetail.tsx` (new).
- `services/matching_service/app.py` — confirm `/pulse/matches` already filters by `driver_id` and returns enough data; if not, extend.
- `api/bridge.js` — confirm route exists; if not, add the proxy.

## Implementation Outline

1. **Confirm matching-service endpoint shape.** Read `services/matching_service/app.py` for `/pulse/matches`. The response should include: `match_id`, `batch_id`, `match_score`, `total_distance_km`, `estimated_duration_minutes`, `expires_at`, and a `breakdown` of stops. If it returns only IDs, extend the endpoint to JOIN through `batches` + `batch_items` + `orders` so the dashboard doesn't need 5 round-trips.
2. **Server route.** `GET /api/driver/pulse-jobs` calls bridge, also fetches vendor names + customer first names from Supabase, returns a merged shape ready for rendering.
3. **Card component.** Show: 1-line address summary ("Pickup: Sai General Store, MG Rd → 2 more → Drop: Anjali in Kothrud"), match score as a badge, payout in the local currency, big green Accept button.
4. **Detail view.** Drawer or modal with the route stops, time per leg (from `routes.estimated_duration_minutes`), exact split of vendor/driver/platform.
5. **Accept flow.** `POST /api/driver/pulse-jobs/:matchId/accept` calls the bridge to assign the batch, marks other Pulse matches for the same batch as invalidated (the worker will clean them up but UI should optimistically remove them).
6. **Polling / refresh.** A simple `setInterval(refetch, 30_000)` is enough for v1. Later swap for Supabase realtime subscription on `pulse_matches`.
7. **Fallback.** If `pulse-jobs` returns empty, render the existing proximity-fallback list (filtered to within 10 km using the driver's last known location from `driver_status`).

## Schema Changes

None. `pulse_matches` already exists. Optionally add:

```sql
ALTER TABLE pulse_matches ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_pulse_matches_driver_active
  ON pulse_matches(driver_id, expires_at)
  WHERE invalidated_at IS NULL;
```

(For optimistic invalidation when a driver accepts a batch and we need to clear sibling matches.)

## Test Plan

1. **Pulse fast path.** Seed a driver, a batch, a `pulse_matches` row. Open dashboard → card renders with the seeded values, NOT random ones.
2. **Score sorting.** Two matches: 0.9 and 0.6 score → 0.9 appears first.
3. **Empty state.** Delete all `pulse_matches` rows → dashboard shows fallback proximity list, not blank.
4. **Accept.** Click Accept → `orders.assigned_driver_id` set, `batches.driver_id` set, sibling matches invalidated.
5. **Expiry.** Set `expires_at` in the past → match disappears from UI on next refresh.
6. **Real payout.** Sum of `driver_payout_cents` across the batch's orders matches what the card displayed (no more `Math.random()`).

## Gotchas

- **`Math.random()` payout.** Find every callsite in `inc/src/app/driver/dashboard/page.tsx` and remove. Search the whole `driver/` tree to be sure.
- **Driver location.** The fallback proximity query needs the driver's current location. Pull it from `driver_status` (most recent row) — not from `drivers.location` which is a registered base.
- **Race on accept.** Two drivers can hit Accept on the same batch in the same second. Resolve at the matching service layer with a transactional `UPDATE batches SET driver_id = $1 WHERE id = $2 AND driver_id IS NULL` — second writer gets 0 rows and a "this bundle was just taken" toast.
- **Pulse worker not running locally.** If `DATABASE_URL` is not set, the worker doesn't start (by design — graceful skip, see `CLAUDE.md`). The dashboard will always hit the fallback. Make sure the empty state is genuinely usable, not a placeholder.
- **Polling cost.** A 30-s interval per logged-in driver is fine; if you scale to thousands, switch to Supabase realtime channel on `pulse_matches`.
- **InC psychology copy.** Don't write "47 jobs available, please select one." Write "We saved 3 best bundles for you — pick your favorite." This is the whole point.

## Out of Scope

- Live driver-to-customer chat.
- Multi-modal route hints (turn-by-turn) — out-of-app GPS handoff is fine for v1.
- Real-time driver tracking on the customer side (Spec 05's territory).
- Earnings analytics overhaul — keep the existing earnings card as-is.
- Job decline reasons / feedback loop into the Pulse scoring model (great v2 idea).
