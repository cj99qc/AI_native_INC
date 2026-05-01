import { z } from 'zod'
import { getOpenAI } from '@/lib/openai'

/**
 * Intent classification + goal decomposition for the unified search bar.
 *
 * Three real intents:
 *   - "product": user wants a specific item (returns one component)
 *   - "service": user wants a tradesperson (returns service_slug)
 *   - "goal":    user states an objective; we decompose into components
 *   - "unknown": couldn't classify; UI shows a helpful empty state
 *
 * Decomposition example:
 *   "I want to bake a cake" → 5 product components (flour, sugar, eggs,
 *    butter, baking powder), no service.
 *
 * The same LLM call does classification AND decomposition in one round-trip.
 */

export type ComponentKind = 'product' | 'service'
export type Intent = 'product' | 'service' | 'goal' | 'unknown'

export interface SearchComponent {
  kind: ComponentKind
  term: string
}

export interface ClassifiedQuery {
  intent: Intent
  summary: string
  components: SearchComponent[]
  service_slug: string | null
  cache_hit: boolean
}

const llmResponseSchema = z.object({
  intent: z.enum(['product', 'service', 'goal', 'unknown']),
  summary: z.string().max(200).optional().default(''),
  components: z
    .array(
      z.object({
        kind: z.enum(['product', 'service']),
        term: z.string().min(1).max(100),
      })
    )
    .max(15)
    .default([]),
  service_slug: z.string().max(64).nullable().optional().default(null),
})

const SYSTEM_PROMPT = `You are an intent classifier for a hyperlocal marketplace (think Amazon + TaskRabbit for small Indian neighbourhoods). Your job: classify a user's free-text search and, for goal-oriented queries, decompose it into a shopping list of generic items.

Return STRICT JSON with this shape:
{
  "intent": "product" | "service" | "goal" | "unknown",
  "summary": "<one short sentence describing what the user wants>",
  "components": [{"kind": "product" | "service", "term": "<generic item or service>"}],
  "service_slug": "<one slug from the allowed list, or null>"
}

Rules:
- "product" intent: the user is asking for a specific item (e.g. "flour", "1kg rice", "ibuprofen"). components = [{"kind":"product","term":"<the item, generic, no brand or quantity>"}]. service_slug = null.
- "service" intent: the user is asking for a tradesperson (e.g. "I need a plumber", "electrician for fan"). components = []. service_slug = the matching slug from the allowed list.
- "goal" intent: the user states an outcome that requires multiple items (e.g. "bake a cake", "I want to fix my leaking tap" — that's still a service though, only goal if it needs multiple things). components = 3–8 generic items needed; never include quantities, brand names, or units. service_slug = null unless the goal also implies a tradesperson.
- "unknown" intent: nonsense, off-topic, or impossible (e.g. "find me an astronaut"). components = []. service_slug = null.

Component terms must be:
- Generic English nouns ("flour" not "Aashirvaad Atta 5kg")
- Short (1–3 words)
- Lowercase

Always include a "summary" field, even for unknown.`

const FEW_SHOT: { user: string; assistant: string }[] = [
  {
    user: 'flour',
    assistant: JSON.stringify({
      intent: 'product',
      summary: 'Customer wants flour.',
      components: [{ kind: 'product', term: 'flour' }],
      service_slug: null,
    }),
  },
  {
    user: 'I need a plumber',
    assistant: JSON.stringify({
      intent: 'service',
      summary: 'Customer needs a plumber.',
      components: [],
      service_slug: 'plumber',
    }),
  },
  {
    user: 'I want to bake a cake',
    assistant: JSON.stringify({
      intent: 'goal',
      summary: "Customer wants to bake a cake at home.",
      components: [
        { kind: 'product', term: 'flour' },
        { kind: 'product', term: 'sugar' },
        { kind: 'product', term: 'eggs' },
        { kind: 'product', term: 'butter' },
        { kind: 'product', term: 'baking powder' },
      ],
      service_slug: null,
    }),
  },
  {
    user: 'find me an astronaut',
    assistant: JSON.stringify({
      intent: 'unknown',
      summary: "We can't help with that on this marketplace.",
      components: [],
      service_slug: null,
    }),
  },
]

// ---- LRU cache --------------------------------------------------------------

interface CacheEntry {
  value: Omit<ClassifiedQuery, 'cache_hit'>
  expiresAt: number
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const CACHE_MAX_ENTRIES = 500

class IntentCache {
  private store = new Map<string, CacheEntry>()

  private key(query: string) {
    return query.trim().toLowerCase()
  }

  get(query: string): Omit<ClassifiedQuery, 'cache_hit'> | null {
    const k = this.key(query)
    const entry = this.store.get(k)
    if (!entry) return null
    if (entry.expiresAt < Date.now()) {
      this.store.delete(k)
      return null
    }
    // Bump to MRU.
    this.store.delete(k)
    this.store.set(k, entry)
    return entry.value
  }

  set(query: string, value: Omit<ClassifiedQuery, 'cache_hit'>) {
    const k = this.key(query)
    if (this.store.has(k)) this.store.delete(k)
    this.store.set(k, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    // Evict oldest if over capacity.
    while (this.store.size > CACHE_MAX_ENTRIES) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }
}

const intentCache = new IntentCache()

// ---- Public API -------------------------------------------------------------

/**
 * Classify a query and (if goal-oriented) decompose it into search components.
 * Uses an in-memory LRU cache to avoid re-charging OpenAI for repeated queries.
 *
 * @param query        the user's raw search string
 * @param allowedSlugs valid service category slugs (from service_categories);
 *                     constrains the LLM's `service_slug` output. If the LLM
 *                     returns a slug not in this set, it's nulled out.
 * @returns ClassifiedQuery with intent, summary, components, slug, cache_hit
 */
export async function classifyQuery(
  query: string,
  allowedSlugs: string[]
): Promise<ClassifiedQuery> {
  const trimmed = query.trim()
  if (!trimmed) {
    return {
      intent: 'unknown',
      summary: '',
      components: [],
      service_slug: null,
      cache_hit: false,
    }
  }

  const cached = intentCache.get(trimmed)
  if (cached) {
    return { ...cached, cache_hit: true }
  }

  // Build a slug-aware system prompt so the LLM can only return valid slugs.
  const slugList = allowedSlugs.length > 0
    ? `Allowed service_slug values: ${allowedSlugs.join(', ')}.`
    : 'Allowed service_slug values: (none — return null).'

  const systemPrompt = `${SYSTEM_PROMPT}\n\n${slugList}`

  let parsed: z.infer<typeof llmResponseSchema>
  try {
    const openai = getOpenAI()
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.0,
      max_tokens: 400,
      messages: [
        { role: 'system', content: systemPrompt },
        ...FEW_SHOT.flatMap((s) => [
          { role: 'user' as const, content: s.user },
          { role: 'assistant' as const, content: s.assistant },
        ]),
        { role: 'user', content: trimmed },
      ],
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    const json = JSON.parse(raw)
    parsed = llmResponseSchema.parse(json)
  } catch (err) {
    // Fallback: treat as a plain product query so search still works even if
    // the LLM is down or returns malformed JSON.
    console.warn('[classifyQuery] LLM call/parse failed; falling back to product:', err)
    const fallback: Omit<ClassifiedQuery, 'cache_hit'> = {
      intent: 'product',
      summary: 'Searching for products matching your query.',
      components: [{ kind: 'product', term: trimmed.slice(0, 100) }],
      service_slug: null,
    }
    // Don't cache fallback — we want to retry next time.
    return { ...fallback, cache_hit: false }
  }

  // Defensive: if the LLM returned a slug not in our enum, null it out.
  if (parsed.service_slug && !allowedSlugs.includes(parsed.service_slug)) {
    parsed.service_slug = null
    if (parsed.intent === 'service') {
      // Demote unknown service to a product search of the original query.
      parsed.intent = 'product'
      parsed.components = [{ kind: 'product', term: trimmed.slice(0, 100) }]
    }
  }

  // Defensive: a "product" intent must have at least one component.
  if (parsed.intent === 'product' && parsed.components.length === 0) {
    parsed.components = [{ kind: 'product', term: trimmed.slice(0, 100) }]
  }

  // Defensive: a "service" intent without slug means the LLM made a mistake.
  if (parsed.intent === 'service' && !parsed.service_slug) {
    parsed.intent = 'unknown'
  }

  const result: Omit<ClassifiedQuery, 'cache_hit'> = {
    intent: parsed.intent,
    summary: parsed.summary,
    components: parsed.components,
    service_slug: parsed.service_slug,
  }

  intentCache.set(trimmed, result)
  return { ...result, cache_hit: false }
}
