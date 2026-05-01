import type { SupabaseClient } from '@supabase/supabase-js'
import { generateEmbedding } from '@/lib/embeddings'

/**
 * Product search: embed the term, then query `match_products_nearby` to get
 * the top semantically-similar products that are also within the user's
 * delivery radius. Single round-trip via PostGIS + pgvector.
 */

export interface ProductHit {
  id: string
  name: string
  description: string | null
  price: number
  unit: string | null
  currency: string | null
  images: string[]
  category_id: string | null
  similarity: number
  distance_km: number
  vendor_id: string
  vendor_name: string | null
}

export interface ProductSearchResult {
  term: string
  results: ProductHit[]
  /** If 0 results within radius, suggests the smallest radius that would have results. */
  expansion: { nearest_km: number; suggested_radius_km: number } | null
}

interface SearchInput {
  term: string
  lat: number
  lng: number
  radius_km: number
  match_count?: number
  match_threshold?: number
}

/**
 * Run a single product search for one term.
 * Returns up to `match_count` hits sorted by similarity, plus an optional
 * `expansion` recommendation if no hits were found within radius.
 */
export async function searchProducts(
  supabase: SupabaseClient,
  input: SearchInput
): Promise<ProductSearchResult> {
  const {
    term,
    lat,
    lng,
    radius_km,
    match_count = 10,
    match_threshold = 0.2,
  } = input

  let embedding: number[]
  try {
    embedding = await generateEmbedding(term)
  } catch (err) {
    console.warn(`[searchProducts] embedding failed for "${term}":`, err)
    return { term, results: [], expansion: null }
  }

  const { data, error } = await supabase.rpc('match_products_nearby', {
    query_embedding: embedding as unknown as number[],
    search_lat: lat,
    search_lng: lng,
    search_radius_km: radius_km,
    match_threshold,
    match_count,
  })

  if (error) {
    console.error(`[searchProducts] RPC error for "${term}":`, error)
    return { term, results: [], expansion: null }
  }

  const rows = (data ?? []) as Array<Omit<ProductHit, 'vendor_name'>>

  // If we have no hits, look for the nearest match at any distance to suggest
  // an expanded search radius. Cap at 50 km so we don't surface absurd results.
  let expansion: ProductSearchResult['expansion'] = null
  if (rows.length === 0) {
    const { data: wider } = await supabase.rpc('match_products_nearby', {
      query_embedding: embedding as unknown as number[],
      search_lat: lat,
      search_lng: lng,
      search_radius_km: 50,
      match_threshold,
      match_count: 1,
    })
    const nearest = (wider ?? [])[0]
    if (nearest && typeof nearest.distance_km === 'number') {
      expansion = {
        nearest_km: Math.round(nearest.distance_km * 10) / 10,
        suggested_radius_km: Math.min(50, Math.ceil(nearest.distance_km + 1)),
      }
    }
  }

  // Resolve vendor names for the hits we are returning.
  const vendorIds = Array.from(new Set(rows.map((r) => r.vendor_id))).filter(Boolean)
  let vendorMap = new Map<string, string>()
  if (vendorIds.length > 0) {
    const { data: vendors } = await supabase
      .from('vendors')
      .select('user_id, business_name')
      .in('user_id', vendorIds)
    if (vendors) {
      vendorMap = new Map(
        vendors.map((v: { user_id: string; business_name: string }) => [v.user_id, v.business_name])
      )
    }
  }

  const results: ProductHit[] = rows.map((r) => ({
    ...r,
    vendor_name: vendorMap.get(r.vendor_id) ?? null,
  }))

  return { term, results, expansion }
}
