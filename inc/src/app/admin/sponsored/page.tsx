'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Star,
  DollarSign,
  Clock,
  CheckCircle2,
  PauseCircle,
  XCircle,
  ArrowLeft,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type ListingStatus = 'pending' | 'active' | 'paused' | 'rejected'

type SponsoredListing = {
  id: string
  product_id: string
  vendor_id: string
  daily_budget: number
  status: ListingStatus
  created_at: string
  product: { name: string; price: number }[] | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ListingStatus, string> = {
  pending:  'Pending',
  active:   'Active',
  paused:   'Paused',
  rejected: 'Rejected',
}

const STATUS_BADGE: Record<ListingStatus, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  active:   'bg-green-100  text-green-800',
  paused:   'bg-gray-100   text-gray-700',
  rejected: 'bg-red-100    text-red-800',
}

type FilterTab = 'all' | ListingStatus

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all',      label: 'All'      },
  { value: 'pending',  label: 'Pending'  },
  { value: 'active',   label: 'Active'   },
  { value: 'paused',   label: 'Paused'   },
  { value: 'rejected', label: 'Rejected' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SponsoredPage() {
  const { user, isAdmin } = useAuth()
  const supabase            = useSupabase()

  const [listings,  setListings]  = useState<SponsoredListing[]>([])
  const [loading,   setLoading]   = useState(true)
  const [updating,  setUpdating]  = useState<string | null>(null)   // listing id being updated
  const [tab,       setTab]       = useState<FilterTab>('all')

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchListings = useCallback(async () => {
    if (!user || !isAdmin) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('sponsored_listings')
        .select(`
          id,
          product_id,
          vendor_id,
          daily_budget,
          status,
          created_at,
          product:products!product_id(name, price)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      setListings((data ?? []) as SponsoredListing[])
    } catch (err) {
      console.error('Sponsored listings fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [user, isAdmin, supabase])

  useEffect(() => { fetchListings() }, [fetchListings])

  // ── Status update ────────────────────────────────────────────────────────────
  const updateStatus = async (id: string, newStatus: ListingStatus) => {
    setUpdating(id)

    // Optimistic update
    setListings(prev =>
      prev.map(l => l.id === id ? { ...l, status: newStatus } : l)
    )

    const { error } = await supabase
      .from('sponsored_listings')
      .update({ status: newStatus })
      .eq('id', id)

    if (error) {
      console.error('Status update failed:', error)
      // Revert on failure
      await fetchListings()
    }

    setUpdating(null)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const counts = {
    all:      listings.length,
    pending:  listings.filter(l => l.status === 'pending').length,
    active:   listings.filter(l => l.status === 'active').length,
    paused:   listings.filter(l => l.status === 'paused').length,
    rejected: listings.filter(l => l.status === 'rejected').length,
  }

  const totalActiveBudget = listings
    .filter(l => l.status === 'active')
    .reduce((sum, l) => sum + l.daily_budget, 0)

  const filtered = tab === 'all' ? listings : listings.filter(l => l.status === tab)

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (!user && !loading) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <p className="text-red-600">Access denied. Admin only.</p>
      </div>
    )
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="h-8 w-56 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-gray-200 rounded animate-pulse" />
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Sponsored Listings</h1>
            <p className="text-sm text-gray-600">Review and manage vendor promotions</p>
          </div>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Listings</p>
                <p className="text-2xl font-bold">{counts.all}</p>
              </div>
              <Star className="h-7 w-7 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Pending Review</p>
                <p className="text-2xl font-bold">{counts.pending}</p>
                {counts.pending > 0 && (
                  <p className="text-xs text-yellow-600 mt-0.5">Needs action</p>
                )}
              </div>
              <Clock className="h-7 w-7 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active</p>
                <p className="text-2xl font-bold">{counts.active}</p>
              </div>
              <TrendingUp className="h-7 w-7 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Daily Budget</p>
                <p className="text-2xl font-bold">${totalActiveBudget.toFixed(2)}</p>
              </div>
              <DollarSign className="h-7 w-7 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Filter tabs + table ── */}
      <Tabs value={tab} onValueChange={v => setTab(v as FilterTab)} className="space-y-4">
        <TabsList>
          {FILTER_TABS.map(t => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {counts[t.value] > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                  {counts[t.value]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Single shared content panel — data changes via `filtered` */}
        {FILTER_TABS.map(t => (
          <TabsContent key={t.value} value={t.value}>
            <Card>
              <CardHeader>
                <CardTitle>{t.label === 'All' ? 'All Listings' : `${t.label} Listings`}</CardTitle>
                <CardDescription>
                  {filtered.length === 0
                    ? 'No listings in this category'
                    : `${filtered.length} listing${filtered.length !== 1 ? 's' : ''}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <Star className="h-10 w-10 mb-3 text-gray-300" />
                    <p className="text-sm">No {t.value === 'all' ? '' : t.label.toLowerCase()} listings</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-3 pr-4 font-semibold text-gray-700">Product</th>
                          <th className="pb-3 pr-4 font-semibold text-gray-700">Vendor</th>
                          <th className="pb-3 pr-4 font-semibold text-gray-700 text-right">Budget/day</th>
                          <th className="pb-3 pr-4 font-semibold text-gray-700">Status</th>
                          <th className="pb-3 pr-4 font-semibold text-gray-700">Created</th>
                          <th className="pb-3 font-semibold text-gray-700 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((listing, i) => {
                          const productName  = listing.product?.[0]?.name  ?? 'Unknown product'
                          const productPrice = listing.product?.[0]?.price ?? 0
                          const isUpdating   = updating === listing.id

                          return (
                            <tr key={listing.id} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                              {/* Product */}
                              <td className="py-3 pr-4">
                                <p className="font-medium text-gray-900">{productName}</p>
                                <p className="text-xs text-gray-500">${productPrice.toFixed(2)}</p>
                              </td>

                              {/* Vendor */}
                              <td className="py-3 pr-4">
                                <span className="font-mono text-gray-500 text-xs">
                                  ...{listing.vendor_id.slice(-8)}
                                </span>
                              </td>

                              {/* Budget */}
                              <td className="py-3 pr-4 text-right font-medium text-gray-700">
                                ${listing.daily_budget.toFixed(2)}
                              </td>

                              {/* Status badge */}
                              <td className="py-3 pr-4">
                                <Badge className={STATUS_BADGE[listing.status]}>
                                  {STATUS_LABELS[listing.status]}
                                </Badge>
                              </td>

                              {/* Created */}
                              <td className="py-3 pr-4 text-gray-500">
                                {new Date(listing.created_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day:   'numeric',
                                  year:  'numeric',
                                })}
                              </td>

                              {/* Actions — contextual per status */}
                              <td className="py-3">
                                <div className="flex items-center justify-end gap-2">
                                  {listing.status !== 'active' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isUpdating}
                                      onClick={() => updateStatus(listing.id, 'active')}
                                      className="text-green-700 border-green-300 hover:bg-green-50"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                      Approve
                                    </Button>
                                  )}

                                  {listing.status === 'active' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isUpdating}
                                      onClick={() => updateStatus(listing.id, 'paused')}
                                      className="text-gray-700 border-gray-300 hover:bg-gray-50"
                                    >
                                      <PauseCircle className="h-3.5 w-3.5 mr-1" />
                                      Pause
                                    </Button>
                                  )}

                                  {listing.status !== 'rejected' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isUpdating}
                                      onClick={() => updateStatus(listing.id, 'rejected')}
                                      className="text-red-700 border-red-300 hover:bg-red-50"
                                    >
                                      <XCircle className="h-3.5 w-3.5 mr-1" />
                                      Reject
                                    </Button>
                                  )}

                                  {isUpdating && (
                                    <span className="text-xs text-gray-400 animate-pulse">saving…</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
