/**
 * Service search: hits the matching service `/availability` endpoint via the
 * API bridge to find providers offering a specific service slug near a
 * location. The matching service already handles radius filtering, distance
 * sort, and the nearest-outside-radius "recommendation" fallback.
 */

export interface ServiceOffering {
  id: string
  display_name: string
  description: string | null
  price_strategy: 'flat' | 'hourly' | 'quote'
  base_price_cents: number | null
  hourly_rate_cents: number | null
}

export interface ServiceProviderHit {
  id: string
  name: string
  description: string | null
  distance_km: number
  services: ServiceOffering[]
}

export interface ServiceSearchResult {
  slug: string
  results: ServiceProviderHit[]
  /** Nearest provider outside the radius if no in-radius matches. */
  expansion: { nearest_km: number; provider_name: string; suggested_radius_km: number } | null
  message: string
}

interface SearchInput {
  slug: string
  lat: number
  lng: number
  radius_km: number
}

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:3001'

export async function searchServices(input: SearchInput): Promise<ServiceSearchResult> {
  const { slug, lat, lng, radius_km } = input

  const params = new URLSearchParams({
    service: slug,
    lat: String(lat),
    lng: String(lng),
    radius_km: String(radius_km),
  })

  let json: any
  try {
    const res = await fetch(`${BRIDGE_URL}/api/matching/availability?${params}`, {
      headers: { 'Content-Type': 'application/json' },
      // Short timeout — search must stay responsive even if matching is down.
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      console.warn(`[searchServices] bridge ${res.status} for ${slug}`)
      return {
        slug,
        results: [],
        expansion: null,
        message: 'Service search is temporarily unavailable.',
      }
    }
    json = await res.json()
  } catch (err) {
    console.warn(`[searchServices] bridge call failed for ${slug}:`, err)
    return {
      slug,
      results: [],
      expansion: null,
      message: 'Service search is temporarily unavailable.',
    }
  }

  const providers = Array.isArray(json.providers) ? json.providers : []
  const results: ServiceProviderHit[] = providers.map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    distance_km: typeof p.distance_km === 'number' ? p.distance_km : 0,
    services: Array.isArray(p.services) ? p.services : [],
  }))

  let expansion: ServiceSearchResult['expansion'] = null
  if (results.length === 0 && json.recommendation) {
    const rec = json.recommendation
    expansion = {
      nearest_km: typeof rec.distance_km === 'number' ? rec.distance_km : 0,
      provider_name: rec.name ?? 'a nearby provider',
      suggested_radius_km: Math.ceil((rec.distance_km ?? radius_km * 2) + 1),
    }
  }

  return {
    slug,
    results,
    expansion,
    message: typeof json.message === 'string' ? json.message : '',
  }
}
