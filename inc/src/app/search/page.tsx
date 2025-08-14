'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  Search, 
  Filter, 
  MapPin, 
  Star, 
  Clock, 
  DollarSign,
  Utensils,
  ShoppingCart,
  Package,
  Heart
} from 'lucide-react'
import { VoiceButton } from '@/components/ui/VoiceButton'
import Image from 'next/image'
import Link from 'next/link'

type SearchResult = { 
  id: string
  name: string
  description: string | null
  price: number
  image?: string
  vendor?: string
  rating?: number
  deliveryTime?: string
  category?: string
  distance?: number
}

const categoryFilters = [
  { id: 'all', label: 'All', icon: Package, color: 'bg-gray-500' },
  { id: 'restaurants', label: 'Restaurants', icon: Utensils, color: 'bg-red-500' },
  { id: 'grocery', label: 'Grocery', icon: ShoppingCart, color: 'bg-green-500' },
  { id: 'retail', label: 'Retail', icon: Package, color: 'bg-blue-500' }
]

const sortOptions = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'distance', label: 'Distance' },
  { id: 'price_low', label: 'Price: Low to High' },
  { id: 'price_high', label: 'Price: High to Low' },
  { id: 'rating', label: 'Rating' }
]

async function searchProducts(q: string, category: string = 'all', sort: string = 'relevance'): Promise<SearchResult[]> {
  try {
    const res = await fetch('/api/search/semantic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, category, sort }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.results || []
  } catch (error) {
    console.error('Search failed:', error)
    return []
  }
}

function SearchResultSkeleton() {
  return (
    <Card className="overflow-hidden border-0 shadow-md">
      <Skeleton className="h-48 w-full" />
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

function SearchContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('relevance')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    const q = searchParams.get('q') || ''
    if (q !== query) {
      setQuery(q)
    }
    if (q) {
      performSearch(q, category, sort)
    }
  }, [searchParams, category, sort])

  const performSearch = async (q: string, cat: string = 'all', sortBy: string = 'relevance') => {
    if (!q.trim()) return
    
    setLoading(true)
    try {
      const searchResults = await searchProducts(q, cat, sortBy)
      setResults(searchResults)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (searchQuery: string) => {
    const trimmedQuery = searchQuery.trim()
    if (trimmedQuery) {
      setQuery(trimmedQuery)
      router.push(`/search?q=${encodeURIComponent(trimmedQuery)}`)
    }
  }

  const handleVoiceSearch = (transcript: string) => {
    handleSearch(transcript)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="mx-auto max-w-7xl p-4 space-y-6">
        {/* Search Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Main Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              type="text"
              placeholder="Search for products, restaurants, stores..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(query)
                }
              }}
              className="pl-12 pr-16 h-12 text-lg rounded-full border-2 border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400"
            />
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
              <VoiceButton onTranscript={handleVoiceSearch} />
              <Button
                onClick={() => handleSearch(query)}
                size="sm"
                className="h-8 px-4 rounded-full bg-blue-600 hover:bg-blue-700"
              >
                Search
              </Button>
            </div>
          </div>

          {/* Filters and Categories */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="gap-2"
            >
              <Filter className="h-4 w-4" />
              Filters
            </Button>

            {/* Category Pills */}
            <div className="flex flex-wrap gap-2">
              {categoryFilters.map((cat) => (
                <motion.button
                  key={cat.id}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setCategory(cat.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    category === cat.id
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-300'
                  }`}
                >
                  <cat.icon className="h-4 w-4" />
                  {cat.label}
                </motion.button>
              ))}
            </div>

            {/* Sort Dropdown */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
            >
              {sortOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Search Results Summary */}
          {query && !loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400"
            >
              <span>
                {results.length > 0 
                  ? `Found ${results.length} results for "${query}"`
                  : `No results found for "${query}"`
                }
              </span>
            </motion.div>
          )}
        </motion.div>

        {/* Search Results */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          {loading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <SearchResultSkeleton key={index} />
              ))}
            </div>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {results.map((result, index) => (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Link href={`/product/${result.id}`}>
                    <Card className="overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 group cursor-pointer">
                      <div className="relative h-48 overflow-hidden">
                        {result.image ? (
                          <Image
                            src={result.image}
                            alt={result.name}
                            width={300}
                            height={200}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="h-full w-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center">
                            <Package className="h-12 w-12 text-gray-400" />
                          </div>
                        )}
                        <div className="absolute top-3 right-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 bg-white/80 hover:bg-white rounded-full"
                          >
                            <Heart className="h-4 w-4" />
                          </Button>
                        </div>
                        {result.deliveryTime && (
                          <div className="absolute bottom-3 left-3">
                            <Badge className="bg-white/90 text-gray-900 text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              {result.deliveryTime}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-start justify-between">
                            <h3 className="font-semibold text-gray-900 dark:text-white line-clamp-2">
                              {result.name}
                            </h3>
                            {result.rating && (
                              <div className="flex items-center gap-1 ml-2">
                                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                                <span className="text-sm font-medium">{result.rating}</span>
                              </div>
                            )}
                          </div>
                          {result.description && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                              {result.description}
                            </p>
                          )}
                          <div className="flex items-center justify-between pt-2">
                            <div className="flex items-center gap-1">
                              <DollarSign className="h-4 w-4 text-green-600" />
                              <span className="font-bold text-lg text-green-600">
                                {Number(result.price).toFixed(2)}
                              </span>
                            </div>
                            {result.vendor && (
                              <div className="flex items-center gap-1 text-xs text-gray-500">
                                <MapPin className="h-3 w-3" />
                                {result.vendor}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : query && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-12"
            >
              <Package className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                No results found
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Try adjusting your search terms or browse our categories
              </p>
              <Button
                onClick={() => {
                  setQuery('')
                  setCategory('all')
                  router.push('/search')
                }}
                variant="outline"
              >
                Clear Search
              </Button>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="mx-auto max-w-7xl p-4">
          <Skeleton className="h-12 w-full mb-6 rounded-full" />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <SearchResultSkeleton key={index} />
            ))}
          </div>
        </div>
      </div>
    }>
      <SearchContent />
    </Suspense>
  )
}