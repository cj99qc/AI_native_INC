import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getOpenAI } from '@/lib/openai'
import { createServerSupabase } from '@/lib/supabase/server'
import { getRatelimit } from '@/lib/rate-limit'

const schema = z.object({ 
  q: z.string().min(1),
  location: z.object({
    lat: z.number(),
    lng: z.number()
  }).optional(),
  radius_km: z.number().min(1).max(100).default(30),
  price_range: z.object({
    min: z.number().optional(),
    max: z.number().optional()
  }).optional(),
  vendor_id: z.string().uuid().optional()
})

export async function POST(req: NextRequest) {
  const ratelimit = getRatelimit()
  const id = req.headers.get('x-forwarded-for') ?? 'anonymous'
  const rl = await ratelimit.limit(`search:${id}`)
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request', details: parsed.error }, { status: 400 })

  const { q, location, radius_km, price_range, vendor_id } = parsed.data

  const openai = getOpenAI()
  const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: q })
  const vector = emb.data[0].embedding

  const supabase = await createServerSupabase()
  
  try {
    const productQuery = supabase.rpc('match_products', {
      query_embedding: vector as unknown as number[],
      match_threshold: 0.2,
      match_count: 50,
    })

    // Get initial semantic matches
    const { data: semanticMatches, error: semanticError } = await productQuery

    if (semanticError) {
      return NextResponse.json({ error: semanticError.message }, { status: 500 })
    }

    type SemanticMatch = {
      id: string
      name: string
      description: string
      price: number
      similarity: number
    }

    let filteredResults = (semanticMatches || []) as SemanticMatch[]

    // Apply geo-filtering if location provided
    if (location && filteredResults.length > 0) {
      const { data: geoFilteredResults } = await supabase
        .from('products')
        .select(`
          id, name, description, price,
          vendor_id,
          availability_radius_km,
          geo_point
        `)
        .in('id', filteredResults.map(r => r.id))
        .not('geo_point', 'is', null)

      if (geoFilteredResults) {
        // Filter by distance using PostGIS
        const nearbyProducts = []
        for (const product of geoFilteredResults) {
          // Check if product is within delivery radius
          const maxRadius = Math.min(radius_km, product.availability_radius_km || 30)
          
          const { data: isNearby } = await supabase.rpc('point_within_radius', {
            check_point: `POINT(${location.lng} ${location.lat})`,
            center_point: product.geo_point,
            radius_meters: maxRadius * 1000
          }).single()

          if (isNearby) {
            // Calculate actual distance for sorting
            const { data: distance } = await supabase
              .rpc('calculate_distance', {
                point1: `POINT(${location.lng} ${location.lat})`,
                point2: product.geo_point
              })
              .single()

            nearbyProducts.push({
              ...filteredResults.find(r => r.id === product.id)!,
              distance_km: distance || 0,
              availability_radius_km: product.availability_radius_km
            })
          }
        }

        // Sort by semantic similarity first, then by distance
        filteredResults = nearbyProducts.sort((a, b) => {
          const simDiff = (b.similarity || 0) - (a.similarity || 0)
          if (Math.abs(simDiff) > 0.1) return simDiff // Significant similarity difference
          return (a.distance_km || 0) - (b.distance_km || 0) // Then by distance
        })
      }
    }

    // Apply price filtering
    if (price_range && (price_range.min || price_range.max)) {
      filteredResults = filteredResults.filter(product => {
        if (price_range.min && product.price < price_range.min) return false
        if (price_range.max && product.price > price_range.max) return false
        return true
      })
    }

    // Apply vendor filtering
    if (vendor_id) {
      const { data: vendorProducts } = await supabase
        .from('products')
        .select('id')
        .eq('vendor_id', vendor_id)
        .in('id', filteredResults.map(r => r.id))

      const vendorProductIds = vendorProducts?.map(p => p.id) || []
      filteredResults = filteredResults.filter(product => 
        vendorProductIds.includes(product.id)
      )
    }

    // Log search analytics
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('analytics_events')
        .insert({
          user_id: user.id,
          event_type: 'semantic_search',
          data: {
            query: q,
            location,
            radius_km,
            price_range,
            vendor_id,
            results_count: filteredResults.length,
            has_geo_filter: !!location
          },
          ai_insights: {
            semantic_similarity_used: true,
            geo_filtering_applied: !!location,
            average_similarity: filteredResults.length > 0 
              ? (filteredResults.reduce((sum, r) => sum + (r.similarity || 0), 0) / filteredResults.length)
              : 0
          }
        })
    }

    return NextResponse.json({ 
      results: filteredResults.slice(0, 20), // Limit final results
      total_found: filteredResults.length,
      search_metadata: {
        query: q,
        location_filtered: !!location,
        radius_km: location ? radius_km : null,
        price_filtered: !!price_range,
        vendor_filtered: !!vendor_id
      }
    })

  } catch (error) {
    console.error('Semantic search error:', error)
    return NextResponse.json({ error: 'search_failed' }, { status: 500 })
  }
}