# INC Platform Development Progress

This directory contains the persistent record of work done and work queued. Use this to understand where the project stands and what's being built next.

## Start Here

For a new session or new agent:

1. **`PRODUCT_BLUEPRINT.md`** ← Read first
   - Complete product vision and architecture overview
   - Explains what the platform is trying to do
   - Who are the users (vendors, customers, drivers)
   - The three pillars: The Pulse, The Handshake, Decision Made Easy
   - Technical architecture: schema, microservices, Next.js, API Bridge
   - 7-step build plan overview

2. **`BUILD_ORCHESTRATOR.md`** ← Read second
   - Master task list: all 7 steps with acceptance criteria
   - Current status: which steps are done, which are next, which are pending
   - Execution rules: how to continue work
   - Dependencies: which steps unlock which
   - Git commit conventions
   - Quick reference to key files

3. **`project_status.md`** ← Read third
   - Detailed status of the current step (what was just completed)
   - Files created/modified in the last session
   - Key implementation patterns and trade-offs
   - Known issues or limitations
   - Testing status: what's been tested, what's pending
   - Next session checklist

## The 7-Step Plan at a Glance

| Step | Status | What It Does |
|------|--------|--------------|
| 1 | ✅ DONE | Vendor onboarding (signup, geolocation, hours, KYC, payout) |
| 2 | ✅ DONE | Product catalog (forms, CRUD API, image upload, embeddings) |
| 3 | ⏭️ NEXT | Multi-service providers (vendors list multiple services with pricing) |
| 4 | ⏱️ PENDING | Unified LLM search (products + services + intent parsing) |
| 5 | ⏱️ PENDING | Checkout → escrow + batch + driver matching |
| 6 | ⏱️ PENDING | Reviews & ratings (customer trust signal) |
| 7 | ⏱️ PENDING | Pulse driver dashboard (pre-computed match opportunities) |

**Total work completed:** ~2 days  
**Remaining effort:** ~7–8 days  
**Current focus:** Building the core marketplace mechanics (vendor → product → search → checkout)

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                      INC Marketplace Platform                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐         ┌───────────────────────────────┐  │
│  │  Next.js App     │         │   Microservices (FastAPI)     │  │
│  │  (Port 3000)     │         │                               │  │
│  ├──────────────────┤         ├───────────────────────────────┤  │
│  │ Pages:           │         │ - Pricing Service (8001)      │  │
│  │ - Vendor signup  │◄────────┤ - Routing Service (8002)      │  │
│  │ - Products       │   HTTP  │ - Matching Service (8003)     │  │
│  │ - Search         │  Bridge │ - Escrow Service (8004)       │  │
│  │ - Checkout       │  (3001) │ - RAG Agent (8005)            │  │
│  │ - Driver jobs    │         │                               │  │
│  │                  │         │ Services run autonomously:    │  │
│  │ API Routes:      │         │ - The Pulse: background       │  │
│  │ - /api/products  │         │   matching (every 30s)        │  │
│  │ - /api/checkout  │         │ - Escrow: payment holds       │  │
│  │ - /api/search    │         │ - RAG: semantic search        │  │
│  │ - /api/orders    │         │                               │  │
│  └──────────────────┘         └───────────────────────────────┘  │
│           │                              ▲                        │
│           └──────────────────────────────┘                        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │       PostgreSQL + PostGIS (Database with Geospatial)        │ │
│  │                                                               │ │
│  │  Tables: vendors, products, orders, batches, routes,        │ │
│  │          escrows, pulse_matches, reviews, driver_status     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │    Supabase Storage (Images) + Auth + Realtime Events       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Key Design Principles:**
- Microservices communicate via HTTP (API Bridge), never direct imports
- All locations use PostGIS GEOGRAPHY (never Euclidean distance)
- Autonomy first: The Pulse pre-computes matches, doesn't wait for user requests
- Trust through escrow: payments held until delivery confirmed
- LLM-powered: search understands intent, not just keywords

## For the Next Agent

When you pick up this project:

1. **Confirm your starting point** — Read this README, then BUILD_ORCHESTRATOR. It will tell you which step to start.

2. **Read the feature spec** — Each step has a detailed spec in `docs/features/NN-{name}.md`. Specs are self-contained; you can understand requirements without conversation history.

3. **Implement step by step** — Don't jump ahead. Dependencies are real.
   - Example: Step 5 (Checkout) needs Step 2 (Products) to have real data to price
   - Example: Step 4 (Search) works better if Step 3 (Services) is done first

4. **Test before declaring done** — Type checking is not enough. Test in browser.
   - Create a vendor account
   - List a product
   - Search for it
   - Track through order flow
   - Verify RLS policies work (vendor can only edit their own products)

5. **Update memory after each step** — Edit BUILD_ORCHESTRATOR and project_status with what you built.
   - This becomes the source of truth for the next session
   - One sentence per major file: "Added X table", "Created form at Y", etc.

6. **Commit to git** — Each step gets one clear commit. Use the commit format in BUILD_ORCHESTRATOR.

## Files in This Directory

- **`PRODUCT_BLUEPRINT.md`** — Master blueprint: vision, architecture, 7-step plan (8 KB)
- **`BUILD_ORCHESTRATOR.md`** — Execution guide: status, dependencies, rules (6 KB)
- **`project_status.md`** — Session record: what was built, known issues, next steps (5 KB)
- **`README.md`** ← you are here

## Key Concepts

### The Pulse
- Background worker runs continuously (every 30 seconds)
- Queries active drivers + pending batches
- Pre-computes optimal matches using full matching engine
- Stores results in `pulse_matches` table
- Driver dashboard queries pre-computed matches → instant results (< 10ms)
- Autonomy: drivers don't search for jobs, platform presents opportunities

### The Handshake
- Payment escrow per vendor
- Customer pays platform → platform holds funds
- Vendor ships → customer confirms delivery
- On delivery, funds released to vendor (minus platform commission)
- Dispute flow: customer disputes → escrow goes "disputed" → admin reviews → release or refund
- All state transitions logged for audit trail

### Decision Made Easy
- System decides, user confirms (not vice versa)
- "We found 3 bundles for you — best earns ₹420 in 22 minutes" vs. "Please select from 127 options"
- Show outcomes, not processes
- Concrete numbers ("₹420") not vague descriptions ("competitive payout")

## Quick Links

- **Full README:** `../../README.md`
- **Architecture Guide:** `../../CLAUDE.md`
- **Feature Specs:** `../features/`
- **Database Schema:** `../../infra/supabase/master_schema.sql`
- **Next.js App:** `../../inc/`
- **Microservices:** `../../services/`
- **API Bridge:** `../../api/`

## Contact / Questions

This is a self-guided document. If you're an AI agent continuing this work:
- Each spec file (`docs/features/NN-{name}.md`) has detailed acceptance criteria
- Each step has estimated effort (1–2 days)
- No questions should go unanswered by reading the specs

If you're a human reviewing progress:
- Check `project_status.md` for what was last built
- Check `BUILD_ORCHESTRATOR.md` for what's queued
- Feature specs are linked in each section

---

**Project Status:** Steps 1–2 complete, Step 3 queued  
**Last Updated:** 2026-05-01  
**Maintenance:** Automated via BUILD_ORCHESTRATOR + project_status updates after each step
