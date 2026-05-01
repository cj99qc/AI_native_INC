'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Activity,
  Truck,
  ShoppingCart,
  Package,
  Zap,
  Server,
} from 'lucide-react'
import Link from 'next/link'
import type { ServicesResponse, ServiceHealth } from '@/app/api/ops/services/route'

// ─── Types ────────────────────────────────────────────────────────────────────

type Snapshot = {
  totalDrivers:     number
  pendingOrders:    number
  openJobs:         number
  activeDeliveries: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ServiceHealth['status'] }) {
  if (status === 'up')
    return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
  if (status === 'down')
    return <XCircle className="h-5 w-5 text-red-500 shrink-0" />
  return <HelpCircle className="h-5 w-5 text-gray-400 shrink-0" />
}

function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms === null) return null
  const colour = ms < 200 ? 'bg-green-100 text-green-700'
    : ms < 800 ? 'bg-yellow-100 text-yellow-700'
    : 'bg-red-100 text-red-700'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${colour}`}>
      {ms}ms
    </span>
  )
}

const SERVICE_LABELS: Record<string, string> = {
  pricing:  'Pricing',
  routing:  'Routing',
  matching: 'Matching',
  escrow:   'Escrow',
  rag:      'RAG Agent',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsControlRoom() {
  const { user, isAdmin } = useAuth()
  const supabase            = useSupabase()

  const [services,      setServices]      = useState<ServicesResponse | null>(null)
  const [snapshot,      setSnapshot]      = useState<Snapshot | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(true)
  const [loadingSnap,   setLoadingSnap]   = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [lastChecked,   setLastChecked]   = useState<Date | null>(null)

  // ── Service health via API route ─────────────────────────────────────────────
  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true)
    try {
      const res  = await fetch('/api/ops/services', { cache: 'no-store' })
      const data = await res.json() as ServicesResponse
      setServices(data)
      setLastChecked(new Date())
    } catch (err) {
      console.error('Service health fetch error:', err)
    } finally {
      setLoadingHealth(false)
    }
  }, [])

  // ── Platform snapshot via Supabase ────────────────────────────────────────────
  const fetchSnapshot = useCallback(async () => {
    if (!user || !isAdmin) return
    setLoadingSnap(true)
    try {
      const [
        { count: totalDrivers },
        { count: pendingOrders },
        { count: openJobs },
        { count: activeDeliveries },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'driver'),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'paid']),
        supabase
          .from('delivery_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open'),
        supabase
          .from('delivery_jobs')
          .select('id', { count: 'exact', head: true })
          .in('status', ['assigned', 'in_transit']),
      ])

      setSnapshot({
        totalDrivers:     totalDrivers     ?? 0,
        pendingOrders:    pendingOrders    ?? 0,
        openJobs:         openJobs         ?? 0,
        activeDeliveries: activeDeliveries ?? 0,
      })
    } catch (err) {
      console.error('Snapshot fetch error:', err)
    } finally {
      setLoadingSnap(false)
    }
  }, [user, isAdmin, supabase])

  useEffect(() => {
    fetchHealth()
    fetchSnapshot()
  }, [fetchHealth, fetchSnapshot])

  // ── Manual refresh ────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchHealth(), fetchSnapshot()])
    setRefreshing(false)
  }

  // ── Guards ────────────────────────────────────────────────────────────────────
  if (!user && !loadingHealth && !loadingSnap) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <p className="text-red-600">Access denied. Admin only.</p>
      </div>
    )
  }

  const loading = loadingHealth || loadingSnap

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (loading && !services && !snapshot) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-48 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────────
  const bridgeUp    = services?.bridge.status === 'up'
  const servicesUp  = services?.services.filter(s => s.status === 'up').length ?? 0
  const servicesAll = services?.services.length ?? 5
  const pulse       = services?.pulse

  // ── Render ────────────────────────────────────────────────────────────────────
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
            <h1 className="text-2xl font-bold">Operations Control Room</h1>
            <p className="text-sm text-gray-600">
              {lastChecked
                ? `Last checked ${lastChecked.toLocaleTimeString()}`
                : 'Live service health and platform stats'}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* ── Service health grid ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Microservice Health
              </CardTitle>
              <CardDescription>
                {bridgeUp
                  ? `Bridge up · ${servicesUp}/${servicesAll} services healthy`
                  : 'Bridge unreachable — service status unknown'}
              </CardDescription>
            </div>
            {/* Bridge badge */}
            <Badge className={bridgeUp ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
              Bridge {bridgeUp ? 'up' : 'down'}
              {services?.bridge.latency_ms != null && bridgeUp && (
                <span className="ml-1 opacity-70">{services.bridge.latency_ms}ms</span>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {(services?.services ?? SERVICE_NAMES_PLACEHOLDER).map(svc => (
              <div
                key={svc.name}
                className="flex flex-col gap-1.5 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    {SERVICE_LABELS[svc.name] ?? svc.name}
                  </span>
                  <StatusDot status={svc.status} />
                </div>
                <div className="flex items-center gap-1">
                  <LatencyBadge ms={svc.latency_ms} />
                  {svc.status === 'down' && (
                    <span className="text-xs text-red-600">Down</span>
                  )}
                  {svc.status === 'unknown' && (
                    <span className="text-xs text-gray-400">Unknown</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Pulse + Snapshot row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* The Pulse */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-red-500" />
              The Pulse
            </CardTitle>
            <CardDescription>Autonomous background matching worker</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Running status */}
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full shrink-0 ${
                pulse?.running ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
              }`} />
              <span className="font-medium">
                {pulse?.running ? 'Running' : 'Stopped'}
              </span>
              {pulse?.error && (
                <span className="text-xs text-red-500">{pulse.error}</span>
              )}
            </div>

            {pulse?.running && (
              <div className="space-y-2 text-sm">
                {pulse.total_matches != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Pre-computed matches</span>
                    <span className="font-semibold flex items-center gap-1">
                      <Zap className="h-3.5 w-3.5 text-yellow-500" />
                      {pulse.total_matches}
                    </span>
                  </div>
                )}
                {pulse.scan_interval_seconds != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Scan interval</span>
                    <span className="font-medium">{pulse.scan_interval_seconds}s</span>
                  </div>
                )}
                {pulse.last_scan && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Last scan</span>
                    <span className="font-medium text-xs">
                      {new Date(pulse.last_scan).toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>
            )}

            {!pulse?.running && !loadingHealth && (
              <p className="text-sm text-gray-500">
                Start the matching service with DATABASE_URL set to activate The Pulse.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Platform snapshot */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-500" />
              Platform Snapshot
            </CardTitle>
            <CardDescription>Live counts from the database</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSnap && !snapshot ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <SnapRow
                  icon={<Truck      className="h-4 w-4 text-orange-500" />}
                  label="Registered drivers"
                  value={snapshot?.totalDrivers ?? 0}
                />
                <SnapRow
                  icon={<ShoppingCart className="h-4 w-4 text-blue-500" />}
                  label="Pending orders"
                  value={snapshot?.pendingOrders ?? 0}
                  highlight={snapshot ? snapshot.pendingOrders > 0 : false}
                />
                <SnapRow
                  icon={<Package    className="h-4 w-4 text-purple-500" />}
                  label="Open delivery jobs"
                  value={snapshot?.openJobs ?? 0}
                  highlight={snapshot ? snapshot.openJobs > 0 : false}
                />
                <SnapRow
                  icon={<Zap        className="h-4 w-4 text-yellow-500" />}
                  label="Active deliveries"
                  value={snapshot?.activeDeliveries ?? 0}
                />
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SnapRow({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon:       React.ReactNode
  label:      string
  value:      number
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        {icon}
        {label}
      </div>
      <span className={`font-bold text-sm ${highlight ? 'text-orange-600' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  )
}

// Placeholder skeleton while bridge hasn't responded yet
const SERVICE_NAMES_PLACEHOLDER: ServiceHealth[] = [
  { name: 'pricing',  status: 'unknown', latency_ms: null },
  { name: 'routing',  status: 'unknown', latency_ms: null },
  { name: 'matching', status: 'unknown', latency_ms: null },
  { name: 'escrow',   status: 'unknown', latency_ms: null },
  { name: 'rag',      status: 'unknown', latency_ms: null },
]
