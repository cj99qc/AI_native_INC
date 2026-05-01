'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts'
import {
  DollarSign,
  ShoppingCart,
  Truck,
  TrendingUp,
  Download,
  ArrowLeft,
  Package,
  Users,
  CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type Order = {
  id: string
  status: string
  total: number
  created_at: string
}

type DeliveryJob = {
  id: string
  status: string
  driver_id: string
  created_at: string
}

type DailyPoint = {
  date: string   // display label e.g. "Mar 5"
  revenue: number
  orders: number
}

type StatusBucket = {
  status: string
  count: number
}

type DriverJobRow = {
  driver_id: string
  status: string
}

type DriverStat = {
  driver_id: string
  completed: number
  active: number
  total: number
  completionRate: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const

type PresetDays = typeof PRESETS[number]['days']

// Canonical order_status enum values (matches inc/supabase/schema.sql)
const STATUS_ORDER = [
  'pending',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
]

const STATUS_COLORS: Record<string, string> = {
  pending:   '#94A3B8',
  paid:      '#60A5FA',
  shipped:   '#FBBF24',
  delivered: '#34D399',
  cancelled: '#F87171',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the ISO date string (YYYY-MM-DD) for N days ago, at midnight UTC */
function isoNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Build an ordered array of YYYY-MM-DD strings covering the last N days */
function buildDateRange(days: number): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    return d.toISOString().split('T')[0]
  })
}

function formatDateLabel(isoDate: string): string {
  return new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  })
}

function exportCSV(orders: Order[]) {
  const header = 'id,status,total,created_at'
  const rows   = orders.map(o => `${o.id},${o.status},${o.total.toFixed(2)},${o.created_at}`)
  const csv    = [header, ...rows].join('\n')
  const blob   = new Blob([csv], { type: 'text/csv' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = `orders_${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { user, isAdmin } = useAuth()
  const supabase           = useSupabase()

  const [preset,       setPreset]       = useState<PresetDays>(30)
  const [orders,       setOrders]       = useState<Order[]>([])
  const [deliveries,   setDeliveries]   = useState<DeliveryJob[]>([])
  const [driverJobs,   setDriverJobs]   = useState<DriverJobRow[]>([])
  const [loading,      setLoading]      = useState(true)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user || !isAdmin) return
    setLoading(true)
    try {
      const since = isoNDaysAgo(preset)
      const [{ data: ordersData }, { data: jobsData }, { data: driverJobsData }] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status, total, created_at')
          .gte('created_at', since),
        supabase
          .from('delivery_jobs')
          .select('id, status, driver_id, created_at')
          .gte('created_at', since),
        supabase
          .from('delivery_jobs')
          .select('driver_id, status')
          .gte('created_at', since)
          .not('driver_id', 'is', null),
      ])
      setOrders(ordersData       ?? [])
      setDeliveries(jobsData     ?? [])
      setDriverJobs(driverJobsData ?? [])
    } catch (err) {
      console.error('Analytics fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [user, isAdmin, preset, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const revenue      = orders.reduce((s, o) => o.status === 'delivered' ? s + o.total : s, 0)
  const completedJobs= deliveries.filter(d => d.status === 'completed').length
  const avgOrderVal  = orders.length > 0 ? orders.reduce((s, o) => s + o.total, 0) / orders.length : 0

  // Daily revenue + order count for line chart
  const dailyPoints: DailyPoint[] = buildDateRange(preset).map(date => {
    const dayOrders = orders.filter(o => o.created_at.startsWith(date))
    return {
      date:    formatDateLabel(date),
      revenue: dayOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0),
      orders:  dayOrders.length,
    }
  })

  // Driver performance — aggregate per driver_id
  const driverStats: DriverStat[] = (() => {
    const map: Record<string, { completed: number; active: number; total: number }> = {}
    for (const row of driverJobs) {
      const id = row.driver_id
      if (!map[id]) map[id] = { completed: 0, active: 0, total: 0 }
      map[id].total++
      if (row.status === 'completed') map[id].completed++
      if (row.status === 'assigned' || row.status === 'in_transit') map[id].active++
    }
    return Object.entries(map)
      .map(([id, counts]) => ({
        driver_id: id,
        ...counts,
        completionRate: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
      }))
      .sort((a, b) => b.completed - a.completed)
  })()

  // Order status breakdown — sorted by pipeline order
  const statusBreakdown: StatusBucket[] = Object.entries(
    orders.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)
  )
    .sort((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0]))
    .map(([status, count]) => ({ status, count }))

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!user && !loading) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <p className="text-red-600">Access denied. Admin only.</p>
      </div>
    )
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="h-8 w-56 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-gray-200 rounded animate-pulse" />
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────
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
            <h1 className="text-2xl font-bold">Detailed Analytics</h1>
            <p className="text-sm text-gray-600">Revenue, orders, and delivery trends</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Range presets */}
          {PRESETS.map(p => (
            <Button
              key={p.days}
              variant={preset === p.days ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPreset(p.days)}
            >
              {p.label}
            </Button>
          ))}

          {/* CSV export */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCSV(orders)}
            disabled={orders.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Metric cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Revenue"
          value={`$${revenue.toFixed(2)}`}
          sub={`Last ${preset} days (delivered)`}
          icon={<DollarSign className="h-7 w-7 text-green-600" />}
        />
        <MetricCard
          label="Orders"
          value={orders.length.toString()}
          sub={`Last ${preset} days`}
          icon={<ShoppingCart className="h-7 w-7 text-blue-600" />}
        />
        <MetricCard
          label="Completed Deliveries"
          value={completedJobs.toString()}
          sub={`Last ${preset} days`}
          icon={<Truck className="h-7 w-7 text-orange-600" />}
        />
        <MetricCard
          label="Avg Order Value"
          value={`$${avgOrderVal.toFixed(2)}`}
          sub="All orders in range"
          icon={<TrendingUp className="h-7 w-7 text-purple-600" />}
        />
      </div>

      {/* ── Charts ── */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenue Trend</TabsTrigger>
          <TabsTrigger value="funnel">Order Funnel</TabsTrigger>
          <TabsTrigger value="drivers">Driver Performance</TabsTrigger>
        </TabsList>

        {/* Revenue over time */}
        <TabsContent value="revenue">
          <Card>
            <CardHeader>
              <CardTitle>Revenue &amp; Orders Over Time</CardTitle>
              <CardDescription>Daily breakdown for the last {preset} days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyPoints}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      interval={preset === 7 ? 0 : preset === 30 ? 4 : 13}
                    />
                    <YAxis
                      yAxisId="rev"
                      orientation="left"
                      tickFormatter={v => `$${Number(v).toFixed(0)}`}
                      width={60}
                    />
                    <YAxis
                      yAxisId="cnt"
                      orientation="right"
                      allowDecimals={false}
                      width={40}
                    />
                    <Tooltip
                      formatter={(value: number | string, name: string) => {
                        const num = Number(value)
                        if (name === 'revenue') return [`$${num.toFixed(2)}`, 'Revenue']
                        return [num, 'Orders']
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="rev"
                      type="monotone"
                      dataKey="revenue"
                      stroke="#10B981"
                      strokeWidth={2}
                      dot={false}
                      name="revenue"
                    />
                    <Line
                      yAxisId="cnt"
                      type="monotone"
                      dataKey="orders"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dot={false}
                      name="orders"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Order status funnel */}
        <TabsContent value="funnel">
          <Card>
            <CardHeader>
              <CardTitle>Order Status Funnel</CardTitle>
              <CardDescription>
                Order counts by status in the last {preset} days
              </CardDescription>
            </CardHeader>
            <CardContent>
              {statusBreakdown.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-500">
                  <Package className="h-6 w-6 mr-2" />
                  No orders in this period
                </div>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusBreakdown} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="status"
                        tick={{ fontSize: 12 }}
                        width={80}
                      />
                      <Tooltip formatter={(v: number | string) => [Number(v), 'Orders']} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {statusBreakdown.map(entry => (
                          <Cell
                            key={entry.status}
                            fill={STATUS_COLORS[entry.status] ?? '#94A3B8'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* Driver performance */}
        <TabsContent value="drivers">
          <Card>
            <CardHeader>
              <CardTitle>Driver Performance</CardTitle>
              <CardDescription>
                Completed and active jobs per driver in the last {preset} days
                {driverStats.length > 0 && ` — ${driverStats.length} active driver${driverStats.length !== 1 ? 's' : ''}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {driverStats.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-gray-500">
                  <Users className="h-6 w-6 mr-2" />
                  No driver activity in this period
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 pr-4 font-semibold text-gray-700">Driver</th>
                        <th className="pb-3 pr-4 font-semibold text-gray-700 text-right">Completed</th>
                        <th className="pb-3 pr-4 font-semibold text-gray-700 text-right">Active</th>
                        <th className="pb-3 pr-4 font-semibold text-gray-700 text-right">Total Jobs</th>
                        <th className="pb-3 font-semibold text-gray-700 text-right">Completion Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {driverStats.map((d, i) => (
                        <tr key={d.driver_id} className={i % 2 === 0 ? 'bg-gray-50' : ''}>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center">
                                <Truck className="h-4 w-4 text-blue-600" />
                              </div>
                              <span className="font-mono text-gray-600">
                                ...{d.driver_id.slice(-8)}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <span className="flex items-center justify-end gap-1 text-green-700 font-medium">
                              <CheckCircle2 className="h-4 w-4" />
                              {d.completed}
                            </span>
                          </td>
                          <td className="py-3 pr-4 text-right text-orange-600 font-medium">
                            {d.active}
                          </td>
                          <td className="py-3 pr-4 text-right text-gray-700">
                            {d.total}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Mini progress bar */}
                              <div className="w-20 h-2 rounded-full bg-gray-200 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-green-500"
                                  style={{ width: `${d.completionRate}%` }}
                                />
                              </div>
                              <span className="text-gray-700 font-medium w-10 text-right">
                                {d.completionRate}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub:   string
  icon:  ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  )
}
