'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Package,
  AlertTriangle,
  Shield,
  Clock,
  UserX,
  CreditCard,
  MessageCircle,
  ArrowLeft,
  ChevronDown,
  CheckCircle2,
  RefreshCw,
  Zap,
  TrendingDown,
  AlertOctagon,
  DollarSign,
  RotateCcw,
  Loader2,
  Navigation,
  Wifi,
  WifiOff,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

type TicketStatus   = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketCategory = 'missing_item' | 'wrong_item' | 'damaged_item' | 'delivery_delay' | 'driver_behavior' | 'payment_issue' | 'other'
type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
type RiskLevel      = 'high' | 'medium' | 'low' | 'unknown'

type Ticket = {
  id:              string
  category:        TicketCategory
  description:     string
  status:          TicketStatus
  priority:        TicketPriority
  created_at:      string
  order_id:        string | null
  resolution_note: string | null
  user_id:         string
}

type PulseContext = {
  pulse:         { match_score: number; trajectory_score: number | null; artery_score: number | null; distance_km: number | null; estimated_acceptance_probability: number | null } | null
  driver_status: { status: string; latitude: number | null; longitude: number | null; speed_kmh: number | null; heading_degrees: number | null; updated_at: string } | null
  job_status:    string | null
  risk_level:    RiskLevel
  reason:        string
} | null

type EscrowSummary = {
  escrow_id:   string
  status:      string
  total_cents: number
} | null

// ─── Meta maps ───────────────────────────────────────────────────────────────

const CATEGORY_META: Record<TicketCategory, { label: string; icon: React.ElementType }> = {
  missing_item:    { label: 'Missing Item',   icon: Package },
  wrong_item:      { label: 'Wrong Item',     icon: AlertTriangle },
  damaged_item:    { label: 'Damaged Item',   icon: Shield },
  delivery_delay:  { label: 'Delivery Delay', icon: Clock },
  driver_behavior: { label: 'Driver Issue',   icon: UserX },
  payment_issue:   { label: 'Payment Issue',  icon: CreditCard },
  other:           { label: 'Something Else', icon: MessageCircle },
}

const STATUS_BADGE: Record<TicketStatus, string> = {
  open:        'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  resolved:    'bg-green-100 text-green-800',
  closed:      'bg-gray-100 text-gray-600',
}

const PRIORITY_BADGE: Record<TicketPriority, string> = {
  low:    'bg-gray-100 text-gray-600',
  normal: 'bg-blue-50 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

const RISK_CONFIG: Record<RiskLevel, { label: string; icon: React.ElementType; badge: string; rowHighlight: string }> = {
  high:    { label: 'High Risk',  icon: AlertOctagon, badge: 'bg-red-100 text-red-700',    rowHighlight: 'border-red-400 bg-red-50' },
  medium:  { label: 'Medium',     icon: TrendingDown, badge: 'bg-orange-100 text-orange-700', rowHighlight: 'border-orange-300' },
  low:     { label: 'Nominal',    icon: Zap,          badge: 'bg-green-100 text-green-700', rowHighlight: '' },
  unknown: { label: 'No Data',    icon: Zap,          badge: 'bg-gray-100 text-gray-500',  rowHighlight: '' },
}

// ─── Pulse Context Badge ──────────────────────────────────────────────────────

function PulseContextBadge({ ctx, loading }: { ctx: PulseContext; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 animate-pulse">
        <Zap className="h-3 w-3" />
        Loading Pulse…
      </div>
    )
  }

  if (!ctx) return null

  const risk   = RISK_CONFIG[ctx.risk_level]
  const RiskIcon = risk.icon

  return (
    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <Zap className="h-3.5 w-3.5 text-yellow-500" />
          Pulse Context
        </div>
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${risk.badge}`}>
          <RiskIcon className="h-3 w-3" />
          {risk.label}
        </span>
      </div>

      {/* Reason */}
      {ctx.reason && (
        <p className="text-xs text-gray-600">{ctx.reason}</p>
      )}

      {/* Score bars */}
      {ctx.pulse && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <ScoreRow label="Match score"      value={ctx.pulse.match_score} />
          {ctx.pulse.trajectory_score != null && (
            <ScoreRow label="Trajectory"     value={ctx.pulse.trajectory_score} />
          )}
          {ctx.pulse.artery_score != null && (
            <ScoreRow label="Artery score"   value={ctx.pulse.artery_score} />
          )}
          {ctx.pulse.distance_km != null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Distance</span>
              <span className="font-medium">{ctx.pulse.distance_km.toFixed(1)} km</span>
            </div>
          )}
        </div>
      )}

      {/* Driver status */}
      {ctx.driver_status && (
        <div className="flex items-center gap-2 border-t pt-2 mt-1">
          {ctx.driver_status.status === 'offline'
            ? <WifiOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
            : <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
          }
          <span className="text-xs text-gray-600 capitalize">
            Driver: <span className="font-medium">{ctx.driver_status.status}</span>
            {ctx.driver_status.speed_kmh != null && (
              <span className="ml-2 text-gray-400">· {ctx.driver_status.speed_kmh.toFixed(0)} km/h</span>
            )}
          </span>
          {ctx.driver_status.heading_degrees != null && (
            <Navigation
              className="h-3 w-3 text-gray-400 shrink-0 ml-auto"
              style={{ transform: `rotate(${ctx.driver_status.heading_degrees}deg)` }}
            />
          )}
        </div>
      )}

      {!ctx.pulse && !ctx.driver_status && (
        <p className="text-xs text-gray-400">No Pulse or driver data available for this order.</p>
      )}
    </div>
  )
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const pct   = Math.round(value * 100)
  const color = pct >= 70 ? 'bg-green-400' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="text-gray-500">{label}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-1 w-full bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Quick Actions panel ──────────────────────────────────────────────────────

function QuickActions({
  escrow,
  loadingEscrow,
  ticketId,
  onActionComplete,
}: {
  escrow:          EscrowSummary
  loadingEscrow:   boolean
  ticketId:        string
  onActionComplete: (action: string) => void
}) {
  const [acting,      setActing]      = useState<'release' | 'refund' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionDone,  setActionDone]  = useState<string | null>(null)
  const [refundNote,  setRefundNote]  = useState('')
  const [showRefundForm, setShowRefundForm] = useState(false)

  const callAction = async (action: 'release' | 'refund') => {
    if (!escrow) return
    setActing(action)
    setActionError(null)
    try {
      const res = await fetch('/api/admin/support/escrow-action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          escrow_id:     escrow.escrow_id,
          action,
          refund_reason: action === 'refund' ? refundNote || undefined : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Action failed')
      setActionDone(action)
      onActionComplete(action)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActing(null)
    }
  }

  if (loadingEscrow) {
    return (
      <div className="text-xs text-gray-400 animate-pulse flex items-center gap-1.5">
        <DollarSign className="h-3 w-3" />
        Loading escrow…
      </div>
    )
  }

  if (!escrow) {
    return (
      <p className="text-xs text-gray-400">No active escrow linked to this order.</p>
    )
  }

  const totalFormatted = (escrow.total_cents / 100).toFixed(2)
  const canAct = escrow.status === 'held' || escrow.status === 'disputed'

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3">
      {/* Escrow status header */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-gray-700">
          <DollarSign className="h-3.5 w-3.5 text-green-600" />
          Escrow · ${totalFormatted}
        </div>
        <Badge className={`text-xs ${
          escrow.status === 'held'     ? 'bg-amber-100 text-amber-800' :
          escrow.status === 'disputed' ? 'bg-red-100 text-red-800' :
          escrow.status === 'released' ? 'bg-green-100 text-green-800' :
          escrow.status === 'refunded' ? 'bg-blue-100 text-blue-800' :
          'bg-gray-100 text-gray-600'
        }`}>
          {escrow.status}
        </Badge>
      </div>

      {/* Action done confirmation */}
      {actionDone && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded px-2 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {actionDone === 'release' ? 'Funds released to vendor & driver.' : 'Refund issued to customer.'}
        </div>
      )}

      {/* Error */}
      {actionError && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{actionError}</p>
      )}

      {/* Buttons */}
      {canAct && !actionDone && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {/* Release funds */}
            <Button
              size="sm"
              className="flex-1 text-xs bg-green-600 hover:bg-green-700 text-white"
              disabled={!!acting}
              onClick={() => callAction('release')}
            >
              {acting === 'release'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              }
              Release Funds
            </Button>

            {/* Issue refund */}
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs border-red-300 text-red-700 hover:bg-red-50"
              disabled={!!acting}
              onClick={() => setShowRefundForm(f => !f)}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Issue Refund
            </Button>
          </div>

          {/* Refund reason form */}
          {showRefundForm && (
            <div className="space-y-2">
              <input
                type="text"
                value={refundNote}
                onChange={e => setRefundNote(e.target.value)}
                placeholder="Reason for refund (optional)"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white"
                  disabled={!!acting}
                  onClick={() => callAction('refund')}
                >
                  {acting === 'refund' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Confirm Refund
                </Button>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowRefundForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!canAct && !actionDone && (
        <p className="text-xs text-gray-500">
          Escrow is <span className="font-medium">{escrow.status}</span> — no actions available.
        </p>
      )}
    </div>
  )
}

// ─── Expanded ticket detail ───────────────────────────────────────────────────

function ExpandedDetail({
  ticket,
  onStatusChange,
  onPriorityChange,
  onResolve,
  updating,
}: {
  ticket:           Ticket
  onStatusChange:   (id: string, status: TicketStatus) => void
  onPriorityChange: (id: string, priority: TicketPriority) => void
  onResolve:        (id: string, note: string) => void
  updating:         boolean
}) {
  const [resolveNote,  setResolveNote]  = useState(ticket.resolution_note ?? '')
  const [showResolve,  setShowResolve]  = useState(false)
  const [pulseCtx,     setPulseCtx]     = useState<PulseContext>(null)
  const [escrow,       setEscrow]       = useState<EscrowSummary>(null)
  const [loadingPulse, setLoadingPulse] = useState(false)
  const [loadingEscrow,setLoadingEscrow]= useState(false)
  const [escrowActDone, setEscrowActDone] = useState<string | null>(null)

  // Fetch Pulse context + escrow in parallel on expand
  useEffect(() => {
    if (!ticket.order_id) return

    setLoadingPulse(true)
    setLoadingEscrow(true)

    const ac = new AbortController()

    fetch(`/api/admin/support/pulse-context?order_id=${ticket.order_id}`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => setPulseCtx(d))
      .catch(() => setPulseCtx(null))
      .finally(() => setLoadingPulse(false))

    fetch(`/api/support/tickets/${ticket.id}/escrow`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => setEscrow(d?.escrow ?? null))
      .catch(() => setEscrow(null))
      .finally(() => setLoadingEscrow(false))

    return () => ac.abort()
  }, [ticket.id, ticket.order_id])

  return (
    <div className="mt-4 border-t pt-4 space-y-4">

      {/* Full description */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1">Description</p>
        <p className="text-sm text-gray-700 leading-relaxed">{ticket.description}</p>
      </div>

      {/* Resolution note if present */}
      {ticket.resolution_note && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2">
          <p className="text-xs font-semibold text-green-700 mb-1">Resolution Note</p>
          <p className="text-sm text-green-900">{ticket.resolution_note}</p>
        </div>
      )}

      {/* Pulse context badge */}
      {ticket.order_id && (
        <PulseContextBadge ctx={pulseCtx} loading={loadingPulse} />
      )}

      {/* Quick actions (escrow) */}
      {ticket.order_id && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Quick Actions</p>
          <QuickActions
            escrow={escrow}
            loadingEscrow={loadingEscrow}
            ticketId={ticket.id}
            onActionComplete={action => setEscrowActDone(action)}
          />
        </div>
      )}

      {/* Admin controls */}
      <div className="flex flex-wrap gap-2 items-center border-t pt-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Priority:</span>
          <select
            value={ticket.priority}
            disabled={updating}
            onChange={e => onPriorityChange(ticket.id, e.target.value as TicketPriority)}
            className="rounded border border-gray-200 bg-white text-xs px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div className="flex gap-2 ml-auto">
          {ticket.status === 'open' && (
            <Button size="sm" variant="outline" disabled={updating}
              onClick={() => onStatusChange(ticket.id, 'in_progress')}>
              Start
            </Button>
          )}
          {(ticket.status === 'open' || ticket.status === 'in_progress') && (
            <Button size="sm" disabled={updating}
              onClick={() => setShowResolve(r => !r)}>
              Resolve
            </Button>
          )}
          {ticket.status === 'resolved' && (
            <Button size="sm" variant="outline" disabled={updating}
              onClick={() => onStatusChange(ticket.id, 'closed')}>
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Resolve panel */}
      {showResolve && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-semibold text-gray-600">Resolution note (optional)</p>
          <textarea
            value={resolveNote}
            onChange={e => setResolveNote(e.target.value)}
            rows={3}
            placeholder="Describe what was done to resolve this issue…"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowResolve(false)} disabled={updating}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => onResolve(ticket.id, resolveNote)} disabled={updating}>
              {updating ? 'Saving…' : 'Mark Resolved'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSupportPage() {
  const supabase          = useSupabase()
  const { user, isAdmin } = useAuth()

  const [tickets,       setTickets]       = useState<Ticket[]>([])
  const [loading,       setLoading]       = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [statusFilter,  setStatusFilter]  = useState<TicketStatus | 'all'>('open')
  const [categoryFilter,setCategoryFilter]= useState<TicketCategory | 'all'>('all')
  const [expanding,     setExpanding]     = useState<string | null>(null)
  const [updating,      setUpdating]      = useState<string | null>(null)

  const [counts, setCounts] = useState<Record<string, number>>({
    all: 0, open: 0, in_progress: 0, resolved: 0, closed: 0,
  })

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    if (!user || !isAdmin) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id, category, description, status, priority, created_at, order_id, resolution_note, user_id')
        .order('created_at', { ascending: false })

      if (error) throw error
      const all = (data ?? []) as Ticket[]

      const c: Record<string, number> = { all: all.length, open: 0, in_progress: 0, resolved: 0, closed: 0 }
      for (const t of all) c[t.status] = (c[t.status] ?? 0) + 1
      setCounts(c)
      setTickets(all)
    } catch (err) {
      console.error('Failed to fetch tickets:', err)
    } finally {
      setLoading(false)
    }
  }, [user, isAdmin, supabase])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchTickets()
    setRefreshing(false)
  }

  // ── Ticket mutations ───────────────────────────────────────────────────────
  const updateStatus = async (id: string, status: TicketStatus) => {
    setUpdating(id)
    setTickets(prev => prev.map(t => t.id === id ? { ...t, status } : t))
    const { error } = await supabase.from('support_tickets').update({ status }).eq('id', id)
    if (error) { console.error(error); await fetchTickets() }
    setUpdating(null)
  }

  const updatePriority = async (id: string, priority: TicketPriority) => {
    setUpdating(id)
    setTickets(prev => prev.map(t => t.id === id ? { ...t, priority } : t))
    const { error } = await supabase.from('support_tickets').update({ priority }).eq('id', id)
    if (error) { console.error(error); await fetchTickets() }
    setUpdating(null)
  }

  const resolveTicket = async (id: string, note: string) => {
    setUpdating(id)
    setTickets(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'resolved', resolution_note: note || null } : t
    ))
    const { error } = await supabase
      .from('support_tickets')
      .update({ status: 'resolved', resolution_note: note || null })
      .eq('id', id)
    if (error) { console.error(error); await fetchTickets() }
    setExpanding(null)
    setUpdating(null)
  }

  // ── Access guard ───────────────────────────────────────────────────────────
  if (!loading && (!user || !isAdmin)) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <p className="text-red-600">Access denied. Admin only.</p>
      </div>
    )
  }

  // ── Filtered view ──────────────────────────────────────────────────────────
  const visible = tickets.filter(t => {
    if (statusFilter !== 'all'   && t.status   !== statusFilter)   return false
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
    return true
  })

  const STATUS_FILTERS = [
    { value: 'all'         as const, label: `All (${counts.all})` },
    { value: 'open'        as const, label: `Open (${counts.open})` },
    { value: 'in_progress' as const, label: `In Progress (${counts.in_progress})` },
    { value: 'resolved'    as const, label: `Resolved (${counts.resolved})` },
    { value: 'closed'      as const, label: `Closed (${counts.closed})` },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-12">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Support Control Tower</h1>
            <p className="text-sm text-gray-600">
              {counts.open} open · {counts.in_progress} in progress
              {visible.filter(t => {
                // Quick count of high-risk tickets in current view
                return false // placeholder — computed after pulse fetch
              }).length > 0 && ' · 🔴 high-risk flagged'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`
                shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors
                ${statusFilter === f.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
              `}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 shrink-0">Category:</label>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as TicketCategory | 'all')}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="all">All categories</option>
            {Object.entries(CATEGORY_META).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </select>
          {(statusFilter !== 'open' || categoryFilter !== 'all') && (
            <button
              onClick={() => { setStatusFilter('open'); setCategoryFilter('all') }}
              className="text-xs text-blue-600 hover:underline"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && visible.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
            <p className="font-semibold text-gray-700">Control tower clear</p>
            <p className="text-sm text-gray-500 mt-1">No tickets match this filter.</p>
          </CardContent>
        </Card>
      )}

      {/* Ticket rows */}
      {!loading && visible.length > 0 && (
        <div className="space-y-3">
          {visible.map(ticket => {
            const catMeta    = CATEGORY_META[ticket.category]
            const Icon       = catMeta.icon
            const isExpanded = expanding === ticket.id
            const isUpdating = updating === ticket.id

            // Row highlight: urgent priority always gets orange ring;
            // Pulse risk highlighting happens inside ExpandedDetail after fetch
            const urgentRing = ticket.priority === 'urgent'
              ? 'border-orange-400 ring-1 ring-orange-300'
              : ''

            return (
              <Card
                key={ticket.id}
                className={`transition-all ${urgentRing} ${isExpanded ? 'shadow-md' : 'hover:shadow-sm'}`}
              >
                <CardContent className="p-4">
                  {/* ── Summary row ── */}
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-gray-600" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{catMeta.label}</span>
                        <Badge className={`text-xs ${STATUS_BADGE[ticket.status]}`}>
                          {ticket.status.replace('_', ' ')}
                        </Badge>
                        <Badge className={`text-xs ${PRIORITY_BADGE[ticket.priority]}`}>
                          {ticket.priority}
                        </Badge>
                        {ticket.order_id && (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Zap className="h-3 w-3 text-yellow-500" />
                            Pulse
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 truncate mt-0.5">{ticket.description}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                        <span>#{ticket.id.slice(-8)}</span>
                        <span>·</span>
                        <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                        {ticket.order_id && (
                          <>
                            <span>·</span>
                            <span>Order #{ticket.order_id.slice(-8)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setExpanding(isExpanded ? null : ticket.id)}
                      className="ml-auto p-1 text-gray-400 hover:text-gray-600"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* ── Expanded detail ── */}
                  {isExpanded && (
                    <ExpandedDetail
                      ticket={ticket}
                      onStatusChange={updateStatus}
                      onPriorityChange={updatePriority}
                      onResolve={resolveTicket}
                      updating={isUpdating}
                    />
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
