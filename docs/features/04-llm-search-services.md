# Spec 04 — Unified LLM Search (Products + Services + Intent Parsing)

## Goal

The single search bar must answer three kinds of queries:

1. **Direct product:** "flour 1kg" → matching products from nearby vendors.
2. **Direct service:** "I need a plumber" → matching service providers.
3. **Goal-oriented:** "I want to bake a cake" → decompose into ingredients (flour, sugar, eggs, butter) **and** related services (home baker for hire), then return both.

Today the search returns products only.

## Why It Matters

The LLM bar is the front door. If a customer types "I need a plumber" and gets zero results, the marketplace looks broken. If they type "I want to bake a cake" and have to manually search 6 ingredients, the platform isn't doing the heavy lifting — that breaks the "Decision Made Easy" principle.

## Current State

- **Endpoint:** `inc/src/app/api/search/semantic/route.ts` — uses OpenAI `text-embedding-3-small`, queries the `products` table only, filters by location radius and price.
- **UI:** `inc/src/app/search/page.tsx` — full search page with voice button stub, hardcoded category filters.
- **RAG agent:** `services/rag_agent/` — sentence-transformers semantic search; today it's only used for support ticket suggestions.
- **No intent parsing.** Plain text → embedding → similarity. No "what is the user actually trying to do?" step.
- **Services invisible.** `service_providers` table is not queried.

## Acceptance Criteria

- [ ] One endpoint `POST /api/search/unified` accepts `{query, lat, lng, radius_km}` and returns `{intent, products, services, recipe_components?, message}`.
- [ ] Intent classifier (lightweight LLM call, e.g., `gpt-4o-mini`) categorizes the query into: `product`, `service`, `goal`, `unknown`.
- [ ] Goal-oriented queries get **decomposed** into a list of `{kind: 'product'|'service', term: string}` items by the same LLM call. Example: "bake a cake" → `[{product, flour}, {product, sugar}, {product, eggs}, {product, butter}, {product, baking powder}]`.
- [ ] For each component, run a parallel semantic search and return grouped results.
- [ ] Service searches hit the matching service `/availability` endpoint with the inferred service_slug. The slug is chosen by the LLM from the `service_categories` enum (Spec 03).
- [ ] Search page renders products and services in two clearly-separated sections. If a goal query, render an InC-Psychology message: *"To bake a cake you'll need 5 things — we found vendors for all of them within 3 km."*
- [ ] Empty results trigger an anticipatory suggestion: *"No plumbers within 5 km. Nearest is 14 km — want us to expand the search?"*
- [ ] Latency budget: ≤ 2 s p95 for product/service queries, ≤ 5 s p95 for goal queries (which fan out).

## Files to Touch

- `inc/src/app/api/search/unified/route.ts` (new) — entry point.
- `inc/src/lib/search/intent.ts` (new) — LLM intent classifier + decomposer.
- `inc/src/lib/search/products.ts` (new) — refactor product search out of the existing route.
- `inc/src/lib/search/services.ts` (new) — call bridge `/api/matching/availability`.
- `inc/src/app/search/page.tsx` — render new response shape, support service results.
- `inc/src/app/api/search/semantic/route.ts` — keep for backwards compat or thin out to delegate to the new lib.
- `services/rag_agent/app.py` — optional: add a `/decompose` endpoint as an alternative to the OpenAI call (cheaper, slower, fully local). For v1 stick with OpenAI.

## Implementation Outline

1. **Intent prompt.** A short system prompt + few-shot examples that classifies and (if `goal`) decomposes the query. Output is strict JSON:
   ```json
   {
     "intent": "goal",
     "summary": "Customer wants to bake a cake at home",
     "components": [
       {"kind": "product", "term": "all-purpose flour"},
       {"kind": "product", "term": "granulated sugar"},
       {"kind": "product", "term": "eggs"},
       {"kind": "product", "term": "butter"},
       {"kind": "product", "term": "baking powder"}
     ],
     "service_slug": null
   }
   ```
   For `service` intent: `{intent: "service", service_slug: "plumber", components: []}`.
   For `product` intent: components has one entry (the original term).
2. **Fan-out search.** For each `{kind: 'product', term}`, embed and query `products`. For each `{kind: 'service', term}` or `service_slug`, call matching service. Run all in parallel with `Promise.all`.
3. **Geospatial filter.** Reuse existing PostGIS `ST_DWithin` logic. Default radius 5 km, expandable.
4. **Empty-result handling.** If a component returns 0 hits, surface "Nearest <term>: <distance> km — expand search?" with a one-click button that re-runs with `radius_km` doubled.
5. **Caching.** Cache the LLM intent classification by query string (Redis or in-memory LRU). The same query twice in a session shouldn't double-charge OpenAI.
6. **Telemetry.** Log `{query, intent, components, latency_ms, num_results}` to a `search_events` table for future tuning.

## Schema Changes (SQL)

```sql
CREATE TABLE IF NOT EXISTS search_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  query       TEXT NOT NULL,
  intent      TEXT NOT NULL,
  components  JSONB,
  latency_ms  INTEGER NOT NULL,
  num_results INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_events_user_created ON search_events(user_id, created_at DESC);
```

## API Contract

**Request:**
```json
POST /api/search/unified
{
  "query": "I want to bake a cake",
  "lat": 18.5204,
  "lng": 73.8567,
  "radius_km": 5
}
```

**Response:**
```json
{
  "intent": "goal",
  "message": "To bake a cake you'll need 5 things — we found vendors for all of them within 3 km.",
  "products": [
    {"term": "all-purpose flour", "results": [{"id":"...","name":"Aashirvaad Atta 5kg","price":280, "vendor":{"name":"Sai General Store","distance_km":0.6}}]},
    {"term": "granulated sugar",  "results": [...]}
  ],
  "services": [],
  "expansion_suggestion": null
}
```

For a service query:
```json
{
  "intent": "service",
  "message": "We found 4 plumbers near you — closest is 1.2 km away.",
  "products": [],
  "services": [
    {"slug": "plumber", "results": [{"id":"...","name":"Ramesh Plumbing", "distance_km":1.2, "services":[{"slug":"leak_repair","name":"Leak Repair","price_cents":50000}]}]}
  ]
}
```

## Test Plan

1. **Intent classifier unit test.** Feed 20 sample queries (provided as fixture), assert correct intent and reasonable decomposition. Use a snapshot test.
2. **End-to-end:** seed a fresh DB with 3 vendors selling flour/sugar/eggs/butter and 2 plumbers; query "bake a cake" — assert all 4 products show up, 0 services. Query "I need a plumber" — assert 2 service results.
3. **Empty:** query "I need an astrophysicist" — assert intent `unknown`, friendly empty-state message.
4. **Latency:** measure p95 with a load script. Should be under 5 s for goal queries.
5. **Cache hit:** same query twice in 10 s should skip the OpenAI call (verify via metrics).

## Gotchas

- **LLM JSON failure.** GPT can return malformed JSON. Use `response_format: {type:'json_object'}` and a Zod parse with a fallback to "treat as plain product query."
- **Component term quality.** "Eggs" is fine; "a dozen eggs" might confuse embedding match. Have the prompt strip quantities and brand names.
- **Service slug must be in the enum.** If LLM returns a slug not in `service_categories`, fall back to fuzzy matching the slug column or treat as product search.
- **Cost.** Each goal query is one classifier call + N embedding calls. Cache aggressively. Consider migrating the classifier to the local `rag_agent` model in v2.
- **Don't double-search.** If intent is `product` with one component, don't do a fan-out — just run one search.
- **Driver privacy.** Never return driver location in search results. Service-provider location is OK because it's their business address.

## Out of Scope

- Voice input wiring (button exists, leave it stubbed).
- Personalized ranking based on past purchases — needs more data first.
- Multi-language queries (Hindi, Marathi, etc.) — punt to v2 with a translate step.
- Saved searches / search history UI (telemetry table exists, UI is later).
