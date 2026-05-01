'use client'

import { useState, useEffect, Suspense, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Search,
  MapPin,
  Package,
  Wrench,
  Sparkles,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
import { VoiceButton } from '@/components/ui/VoiceButton'
import Image from 'next/image'
import Link from 'next/link'

// ---- Types matching /api/search/unified response ----------------------------

type Intent = 'product' | 'service' | 'goal' | 'unknown'

interface ProductHit {
  id: string
  name: string
  description: string | null
  price: number
  unit: string | null
  currency: string | null
  images: string[]
  similarity: number
  distance_km: number
  vendor_id: string
  vendor_name: string | null
}

interface ProductGroup {
  term: string
  results: ProductHit[]
  expansion: { nearest_km: number; suggested_radius_km: number } | null
}

interface ServiceOffering {
  id: string
  display_name: string
  description: string | null
  price_strategy: 'flat' | 'hourly' | 'quote'
  base_price_cents: number | null
  hourly_rate_cents: number | null
}

interface ServiceProviderHit {
  id: string
  name: string
  description: string | null
  distance_km: number
  services: ServiceOffering[]
}

interface ServiceGroup {
  slug: string
  results: ServiceProviderHit[]
  expansion: { nearest_km: number; provider_name: string; suggested_radius_km: number } | null
  message: string
}

interface UnifiedResponse {
  intent: Intent
  message: string
  summary: string
  products: ProductGroup[]
  services: ServiceGroup[]
  expansion_suggestion: { suggested_radius_km: number; reason: string } | null
  meta: { latency_ms: number; cache_hit: boolean; components_searched: number }
}

// ---- Helpers ---------------------------------------------------------------

const DEFAULT_COORDS = { lat: 18.5204, lng: 73.8567 } // Pune

function formatServicePrice(s: ServiceOffering): string {
  if (s.price_strategy === 'flat' && s.base_price_cents != null) {
    return `₹${(s.base_price_cents / 100).toFixed(2)}`
  }
  if (s.price_strategy === 'hourly' && s.hourly_rate_cents != null) {
    return `₹${(s.hourly_rate_cents / 100).toFixed(2)}/hr`
  }
  return 'Quote'
}

function formatPrice(p: number, currency: string | null): string {
  const symbol = currency === 'INR' || !currency ? '₹' : currency + ' '
  return `${symbol}${p.toFixed(2)}`
}

// ---- Skeletons -------------------------------------------------------------

function ResultSkeleton() {
  return (
    <Card className="overflow-hidden border-0 shadow-md">
      <Skeleton className="h-40 w-full" />
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

// ---- Component cards -------------------------------------------------------

function ProductCard({ p }: { p: ProductHit }) {
  return (
    <Link href={`/product/${p.id}`}>
      <Card className="overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 group cursor-pointer h-full">
        <div className="relative h-40 overflow-hidden bg-gradient-to-br from-blue-100 to-purple-100 dark:from-gray-700 dark:to-gray-600">
          {p.images?.[0] ? (
            <Image
              src={p.images[0]}
              alt={p.name}
              width={300}
              height={200}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center">
              <Package className="h-12 w-12 text-gray-400" />
            </div>
          )}
        </div>
        <CardContent className="p-4 space-y-2">
          <h3 className="font-semibold line-clamp-1">{p.name}</h3>
          {p.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
              {p.description}
            </p>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-lg font-bold text-green-600">
              {formatPrice(Number(p.price), p.currency)}
              {p.unit && <span className="text-xs text-gray-500 ml-1">/{p.unit}</span>}
            </span>
            <Badge variant="outline" className="text-xs">
              <MapPin className="h-3 w-3 mr-1" />
              {p.distance_km.toFixed(1)} km
            </Badge>
          </div>
          {p.vendor_name && (
            <p className="text-xs text-gray-500">from {p.vendor_name}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

function ProviderCard({ provider, slug }: { provider: ServiceProviderHit; slug: string }) {
  return (
    <Link href={`/services/${slug}`}>
      <Card className="overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer h-full">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">{provider.name}</h3>
            <Badge variant="outline" className="text-xs whitespace-nowrap">
              <MapPin className="h-3 w-3 mr-1" />
              {provider.distance_km.toFixed(1)} km
            </Badge>
          </div>
          {provider.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
              {provider.description}
            </p>
          )}
          {provider.services.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
              {provider.services.slice(0, 3).map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300 line-clamp-1">
                    {s.display_name}
                  </span>
                  <span className="font-semibold text-green-600 whitespace-nowrap ml-2">
                    {formatServicePrice(s)}
                  </span>
                </div>
              ))}
              {provider.services.length > 3 && (
                <p className="text-xs text-blue-600 pt-1">
                  +{provider.services.length - 3} more services
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

// ---- Main page -------------------------------------------------------------

function SearchContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [data, setData] = useState<UnifiedResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [radiusKm, setRadiusKm] = useState(5)
  const [locationDenied, setLocationDenied] = useState(false)

  // Try to grab the user's location on first paint. Fall back to a default
  // city centroid (Pune) if denied.
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setCoords(DEFAULT_COORDS)
      setLocationDenied(true)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setCoords(DEFAULT_COORDS)
        setLocationDenied(true)
      },
      { timeout: 5000 }
    )
  }, [])

  const performSearch = useCallback(
    async (q: string, lat: number, lng: number, radius: number) => {
      if (!q.trim()) return
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/search/unified', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, lat, lng, radius_km: radius }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.message || err.error || `Search failed (${res.status})`)
        }
        const json = (await res.json()) as UnifiedResponse
        setData(json)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // When q or coords change, run a search (if we have both).
  useEffect(() => {
    const q = searchParams.get('q') || ''
    if (q && coords) {
      setQuery(q)
      performSearch(q, coords.lat, coords.lng, radiusKm)
    }
  }, [searchParams, coords, radiusKm, performSearch])

  const handleSubmit = (q: string) => {
    const trimmed = q.trim()
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`)
    }
  }

  const handleExpand = (newRadius: number) => {
    // Setting radius triggers the effect above which re-runs performSearch —
    // no need to call it directly.
    setRadiusKm(newRadius)
  }

  const totalProducts = data?.products.reduce((n, g) => n + g.results.length, 0) ?? 0
  const totalServices = data?.services.reduce((n, g) => n + g.results.length, 0) ?? 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="mx-auto max-w-7xl p-4 space-y-6">
        {/* Search bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              type="text"
              placeholder='Try "I want to bake a cake" or "I need a plumber"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit(query)
              }}
              className="pl-12 pr-32 h-12 text-lg rounded-full border-2"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <VoiceButton onTranscript={handleSubmit} />
              <Button
                onClick={() => handleSubmit(query)}
                size="sm"
                className="h-8 px-4 rounded-full bg-blue-600 hover:bg-blue-700"
              >
                Search
              </Button>
            </div>
          </div>

          {locationDenied && (
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
              <MapPin className="h-4 w-4" />
              Showing results for Pune. Allow location for results near you.
            </div>
          )}

          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600 dark:text-gray-400">Within</span>
            <select
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="px-2 py-1 rounded border bg-white dark:bg-gray-800"
            >
              <option value={2}>2 km</option>
              <option value={5}>5 km</option>
              <option value={10}>10 km</option>
              <option value={20}>20 km</option>
              <option value={50}>50 km</option>
            </select>
          </div>
        </motion.div>

        {/* Top-line anticipatory message */}
        {data && !loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex items-start gap-3"
          >
            {data.intent === 'goal' ? (
              <Sparkles className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            ) : data.intent === 'service' ? (
              <Wrench className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            ) : (
              <Package className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-medium">{data.message}</p>
              {data.summary && data.intent !== 'product' && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{data.summary}</p>
              )}
            </div>
          </motion.div>
        )}

        {/* Expansion suggestion */}
        {data?.expansion_suggestion && !loading && (
          <button
            onClick={() => handleExpand(data.expansion_suggestion!.suggested_radius_km)}
            className="w-full text-left flex items-center justify-between gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 hover:border-blue-400 transition-colors"
          >
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-blue-600 flex-shrink-0" />
              <span className="text-sm">{data.expansion_suggestion.reason}</span>
            </div>
            <ChevronRight className="h-5 w-5 text-blue-600" />
          </button>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ResultSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Service results */}
        {!loading && data && totalServices > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-blue-600" />
              <h2 className="text-xl font-semibold">Service providers</h2>
            </div>
            {data.services.map((group) => (
              <div key={group.slug} className="space-y-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.results.map((p) => (
                    <ProviderCard key={p.id} provider={p} slug={group.slug} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Product results, grouped by component term */}
        {!loading && data && totalProducts > 0 && (
          <section className="space-y-6">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-600" />
              <h2 className="text-xl font-semibold">
                {data.intent === 'goal' ? 'What you need' : 'Products'}
              </h2>
            </div>
            {data.products.map((group) => (
              <div key={group.term} className="space-y-3">
                {/* Show component header only for goal queries with multiple terms */}
                {data.intent === 'goal' && data.products.length > 1 && (
                  <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                    {group.term}
                    {group.results.length > 0 && (
                      <span className="ml-2 text-gray-400">
                        ({group.results.length})
                      </span>
                    )}
                  </h3>
                )}
                {group.results.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {group.results.map((p) => (
                      <ProductCard key={p.id} p={p} />
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
                    {group.expansion ? (
                      <>
                        No <strong>{group.term}</strong> within {radiusKm} km. Nearest is{' '}
                        {group.expansion.nearest_km} km away.
                      </>
                    ) : (
                      <>No <strong>{group.term}</strong> available nearby.</>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Empty state */}
        {!loading && data && totalProducts === 0 && totalServices === 0 && (
          <Card>
            <CardContent className="p-12 text-center space-y-4">
              <Search className="h-12 w-12 mx-auto text-gray-400" />
              <h3 className="text-lg font-semibold">Nothing matched</h3>
              <p className="text-sm text-gray-600">{data.message}</p>
              {data.expansion_suggestion && (
                <Button
                  onClick={() => handleExpand(data.expansion_suggestion!.suggested_radius_km)}
                >
                  Expand to {data.expansion_suggestion.suggested_radius_km} km
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Initial state — no query yet */}
        {!loading && !data && !query && (
          <Card>
            <CardContent className="p-12 text-center space-y-2">
              <Sparkles className="h-12 w-12 mx-auto text-blue-600" />
              <h3 className="text-lg font-semibold">Ask for anything</h3>
              <p className="text-sm text-gray-600 max-w-md mx-auto">
                Search for a product (&ldquo;flour&rdquo;), a tradesperson (&ldquo;I need a plumber&rdquo;),
                or describe what you&apos;re trying to do (&ldquo;I want to bake a cake&rdquo;) — we&apos;ll find what you need nearby.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Debug meta — remove in prod */}
        {data && process.env.NODE_ENV === 'development' && (
          <details className="text-xs text-gray-400 mt-8">
            <summary className="cursor-pointer">Debug</summary>
            <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded overflow-auto">
              {JSON.stringify(data.meta, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <SearchContent />
    </Suspense>
  )
}
