import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { getRatelimit } from '@/lib/rate-limit'
import { classifyQuery, type ClassifiedQuery } from '@/lib/search/intent'
import { searchProducts, type ProductSearchResult } from '@/lib/search/products'
import { searchServices, type ServiceSearchResult } from '@/lib/search/services'

const requestSchema = z.object({
  query: z.string().min(1).max(500),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  radius_km: z.number().min(1).max(50).default(5),
})

export interface UnifiedSearchResponse {
  intent: ClassifiedQuery['intent']
  message: string
  summary: string
  products: ProductSearchResult[]
  services: ServiceSearchResult[]
  expansion_suggestion: { suggested_radius_km: number; reason: string } | null
  meta: {
    latency_ms: number
    cache_hit: boolean
    components_searched: number
  }
}

/**
 * Build the top-line message shown above search results. Anticipatory and
 * concrete; reads as a recommendation rather than a status report.
 */
function buildMessage(
  intent: ClassifiedQuery['intent'],
  productGroups: ProductSearchResult[],
  serviceGroups: ServiceSearchResult[]
): string {
  const totalProducts = productGroups.reduce((n, g) => n + g.results.length, 0)
  const totalServices = serviceGroups.reduce((n, g) => n + g.results.length, 0)

  if (intent === 'goal') {
    const componentCount = productGroups.length + serviceGroups.length
    const fulfilled = productGroups.filter((g) => g.results.length > 0).length
      + serviceGroups.filter((g) => g.results.length > 0).length
    if (fulfilled === componentCount && componentCount > 0) {
      return `You'll need ${componentCount} ${componentCount === 1 ? 'thing' : 'things'} — we found vendors for all of them.`
    }
    if (fulfilled === 0) {
      return `We couldn't find local vendors for what you need. Try widening the search.`
    }
    return `${fulfilled} of ${componentCount} ${componentCount === 1 ? 'thing' : 'things'} are available nearby — see what's missing below.`
  }

  if (intent === 'service') {
    if (totalServices === 0) {
      return `No providers found nearby — see the suggestion below.`
    }
    const closest = serviceGroups
      .flatMap((g) => g.results)
      .reduce<number | null>((m, r) => (m === null || r.distance_km < m ? r.distance_km : m), null)
    if (closest !== null) {
      return `${totalServices} ${totalServices === 1 ? 'provider' : 'providers'} near you — closest is ${closest.toFixed(1)} km away.`
    }
    return `${totalServices} ${totalServices === 1 ? 'provider' : 'providers'} near you.`
  }

  if (intent === 'product') {
    if (totalProducts === 0) return `Nothing in stock nearby — try widening the search.`
    return `${totalProducts} ${totalProducts === 1 ? 'option' : 'options'} matching your search.`
  }

  // unknown
  return `Try a more specific query — say a product, a service, or a goal like "I want to bake a cake."`
}

/**
 * Compute a single expansion suggestion across all empty component results.
 * Picks the smallest radius that would satisfy the most components.
 */
function buildExpansion(
  productGroups: ProductSearchResult[],
  serviceGroups: ServiceSearchResult[]
): UnifiedSearchResponse['expansion_suggestion'] {
  const expansions: number[] = []
  for (const g of productGroups) {
    if (g.results.length === 0 && g.expansion) expansions.push(g.expansion.suggested_radius_km)
  }
  for (const g of serviceGroups) {
    if (g.results.length === 0 && g.expansion) expansions.push(g.expansion.suggested_radius_km)
  }
  if (expansions.length === 0) return null

  const suggested = Math.max(...expansions)
  return {
    suggested_radius_km: Math.min(50, suggested),
    reason: `Some items are just outside your search area. Expand to ${Math.min(50, suggested)} km to see them all.`,
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  // Rate limit per IP/anon — search is cheap-ish but spammable.
  try {
    const ratelimit = getRatelimit()
    const id = req.headers.get('x-forwarded-for') ?? 'anonymous'
    const rl = await ratelimit.limit(`unified-search:${id}`)
    if (!rl.success) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
  } catch {
    // Rate limit infra missing in dev — proceed.
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const { query, lat, lng, radius_km } = parsed.data

  const supabase = await createServerSupabase()

  // Pull the allowed service slugs so the classifier can only return real ones.
  const { data: categories } = await supabase
    .from('service_categories')
    .select('slug')
  const allowedSlugs = (categories ?? []).map((c: { slug: string }) => c.slug)

  // Step 1: classify the query.
  const classified = await classifyQuery(query, allowedSlugs)

  // Step 2: fan out searches based on intent.
  const productPromises: Promise<ProductSearchResult>[] = []
  const servicePromises: Promise<ServiceSearchResult>[] = []

  if (classified.intent === 'product' || classified.intent === 'goal') {
    for (const c of classified.components) {
      if (c.kind === 'product') {
        productPromises.push(searchProducts(supabase, { term: c.term, lat, lng, radius_km }))
      } else if (c.kind === 'service') {
        // Goals can also imply a service (e.g. "redo my kitchen" → carpenter).
        // Try exact slug match first, then a token match (treat the term as
        // the slug if it appears as a discrete token), to avoid false matches
        // like "ap" → "appliance_repair".
        const t = c.term.toLowerCase().replace(/\s+/g, '_')
        const slug =
          allowedSlugs.find((s) => s === t) ??
          allowedSlugs.find((s) => s.split('_').includes(t))
        if (slug) {
          servicePromises.push(searchServices({ slug, lat, lng, radius_km }))
        }
      }
    }
  }

  if (classified.intent === 'service' && classified.service_slug) {
    servicePromises.push(searchServices({ slug: classified.service_slug, lat, lng, radius_km }))
  }

  const [products, services] = await Promise.all([
    Promise.all(productPromises),
    Promise.all(servicePromises),
  ])

  // Step 3: shape response.
  const message = buildMessage(classified.intent, products, services)
  const expansion = buildExpansion(products, services)
  const totalResults =
    products.reduce((n, g) => n + g.results.length, 0) +
    services.reduce((n, g) => n + g.results.length, 0)
  const latencyMs = Date.now() - startedAt

  // Step 4: log telemetry (fire-and-forget; never block the response on it).
  void (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('search_events').insert({
        user_id: user?.id ?? null,
        query,
        intent: classified.intent,
        components: classified.components,
        service_slug: classified.service_slug,
        latency_ms: latencyMs,
        num_results: totalResults,
        cache_hit: classified.cache_hit,
      })
    } catch (err) {
      console.warn('[unified search] telemetry insert failed:', err)
    }
  })()

  const response: UnifiedSearchResponse = {
    intent: classified.intent,
    summary: classified.summary,
    message,
    products,
    services,
    expansion_suggestion: expansion,
    meta: {
      latency_ms: latencyMs,
      cache_hit: classified.cache_hit,
      components_searched: products.length + services.length,
    },
  }

  return NextResponse.json(response)
}
