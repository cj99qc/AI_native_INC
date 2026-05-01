# Feature Specs — Hyperlocal Marketplace Build Plan

This directory holds **self-contained specs** for the next phase of work on the INC platform. Each spec is designed so an independent agent can pick it up and execute without reading the others.

## Product Vision (Read First)

INC is a **hyperlocal marketplace + logistics platform** — like Amazon × TaskRabbit for small local businesses.

- **Vendors** list products (bakery sells flour; hardware shop sells pipes).
- **Service Providers** list services (plumber, electrician, carpenter, baker-for-hire).
- **Customers** search via an LLM bar: *"I want to bake a cake"* → nearby vendors selling flour, eggs, sugar; *"I need a plumber"* → nearby plumbers.
- The platform runs the **logistics** (multi-vendor batching, routing, driver matching) and the **trust layer** (escrow + dispute resolution).

The architectural rules in `CLAUDE.md` (Artery / Pulse / Handshake / Decision Made Easy) apply to every feature here.

## The 7 Steps

| # | Spec | Status | Depends On |
|---|------|--------|------------|
| 1 | [01-vendor-onboarding.md](./01-vendor-onboarding.md) | pending | — |
| 2 | [02-product-catalog.md](./02-product-catalog.md) | pending | 1 (logically; not strictly) |
| 3 | [03-multi-service-providers.md](./03-multi-service-providers.md) | pending | 1 (logically; not strictly) |
| 4 | [04-llm-search-services.md](./04-llm-search-services.md) | pending | 3 (schema) |
| 5 | [05-checkout-escrow-batch.md](./05-checkout-escrow-batch.md) | pending | 2 (real products) |
| 6 | [06-reviews-ratings.md](./06-reviews-ratings.md) | pending | — |
| 7 | [07-pulse-driver-dashboard.md](./07-pulse-driver-dashboard.md) | pending | — |

Steps 1, 6, 7 are independent and can be parallelized.

## Spec Format

Every spec contains:

1. **Goal** — one paragraph
2. **Why it matters** — business reason (links to vision)
3. **Current state** — what exists in the repo today, with file paths
4. **Acceptance criteria** — checklist
5. **Files to touch** — paths to modify or create
6. **Implementation outline** — concrete steps
7. **Schema changes** — SQL if applicable
8. **Test plan** — how to verify
9. **Gotchas** — known landmines from the existing codebase
10. **Out of scope** — what NOT to do in this PR

## Conventions for Implementing Agents

- All inter-service communication goes through `api/bridge.js` — never import service code from the Next.js app or another service.
- All locations are PostGIS `GEOGRAPHY(POINT, 4326)`. Never do Euclidean math on lat/lng.
- UI copy follows "Decision Made Easy" — surface outcomes, not 47 options. See `CLAUDE.md` for examples.
- Schema changes go in **both** `infra/supabase/master_schema.sql` (production source of truth) and the appropriate Docker init script under `infra/docker/` if the table is needed for local dev.
- Add new env vars to `infra/env.example`, never to `.env.local`.
- Follow existing FastAPI / Next.js / Express patterns — don't introduce new frameworks.
