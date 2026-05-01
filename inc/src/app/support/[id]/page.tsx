'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

type TicketStatus   = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketCategory = 'missing_item' | 'wrong_item' | 'damaged_item' | 'delivery_delay' | 'driver_behavior' | 'payment_issue' | 'other'

type Ticket = {
  id:              string
  category:        TicketCategory
  description:     string
  status:          TicketStatus
  created_at:      string
  updated_at:      string
  order_id:        string | null
  resolution_note: string | null
}

// ─── Meta maps ───────────────────────────────────────────────────────────────

const CATEGORY_META: Record<TicketCategory, { label: string; icon: React.ElementType; colour: string }> = {
  missing_item:    { label: 'Missing Item',   icon: Package,       colour: 'text-orange-600 bg-orange-50' },
  wrong_item:      { label: 'Wrong Item',     icon: AlertTriangle, colour: 'text-yellow-600 bg-yellow-50' },
  damaged_item:    { label: 'Damaged Item',   icon: Shield,        colour: 'text-red-600 bg-red-50' },
  delivery_delay:  { label: 'Delivery Delay', icon: Clock,         colour: 'text-blue-600 bg-blue-50' },
  driver_behavior: { label: 'Driver Issue',   icon: UserX,         colour: 'text-purple-600 bg-purple-50' },
  payment_issue:   { label: 'Payment Issue',  icon: CreditCard,    colour: 'text-green-600 bg-green-50' },
  other:           { label: 'Something Else', icon: MessageCircle, colour: 'text-gray-600 bg-gray-50' },
}

const STATUS_META: Record<TicketStatus, { label: string; badge: string; step: number }> = {
  open:        { label: 'Open',        badge: 'bg-blue-100 text-blue-800',   step: 0 },
  in_progress: { label: 'In Progress', badge: 'bg-yellow-100 text-yellow-800', step: 1 },
  resolved:    { label: 'Resolved',    badge: 'bg-green-100 text-green-800', step: 2 },
  closed:      { label: 'Closed',      badge: 'bg-gray-100 text-gray-600',   step: 3 },
}

// Status timeline steps shown to the user
const TIMELINE_STEPS: { status: TicketStatus; label: string; detail: string }[] = [
  { status: 'open',        label: 'Submitted',    detail: 'We received your ticket' },
  { status: 'in_progress', label: 'In Progress',  detail: 'Our team is looking into this' },
  { status: 'resolved',    label: 'Resolved',     detail: 'Issue has been addressed' },
  { status: 'closed',      label: 'Closed',       detail: 'Ticket closed' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TicketDetailPage() {
  const params   = useParams()
  const id       = params.id as string
  const supabase = useSupabase()
  const { user } = useAuth()

  const [ticket,  setTicket]  = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const fetchTicket = useCallback(async () => {
    if (!user || !id) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id, category, description, status, created_at, updated_at, order_id, resolution_note')
        .eq('id', id)
        .eq('user_id', user.id)   // ownership check — users only see their own
        .single()

      if (error || !data) {
        setNotFound(true)
      } else {
        setTicket(data as Ticket)
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [user, id, supabase])

  useEffect(() => { fetchTicket() }, [fetchTicket])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="h-8 w-40 bg-gray-200 rounded animate-pulse" />
        <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    )
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound || !ticket) {
    return (
      <div className="mx-auto max-w-2xl p-4 text-center pt-20">
        <p className="text-gray-500 font-medium">Ticket not found</p>
        <Link href="/support" className="mt-4 inline-block">
          <Button variant="outline" size="sm">Back to Support</Button>
        </Link>
      </div>
    )
  }

  const catMeta    = CATEGORY_META[ticket.category]
  const statusMeta = STATUS_META[ticket.status]
  const Icon       = catMeta.icon
  const currentStep = statusMeta.step
  const isResolved  = ticket.status === 'resolved' || ticket.status === 'closed'

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-12">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/support">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Ticket #{ticket.id.slice(-8)}</h1>
          <p className="text-sm text-gray-500">
            Opened {new Date(ticket.created_at).toLocaleDateString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Category + status */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${catMeta.colour}`}>
                <Icon className="h-4.5 w-4.5" />
              </div>
              <span className="font-semibold text-gray-900">{catMeta.label}</span>
            </div>
            <Badge className={`text-xs font-medium ${statusMeta.badge}`}>
              {statusMeta.label}
            </Badge>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-700 leading-relaxed border-t pt-3">
            {ticket.description}
          </p>

          {/* Linked order */}
          {ticket.order_id && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
              <Package className="h-4 w-4 shrink-0" />
              <span>Linked to Order #{ticket.order_id.slice(-8)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Progress</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="relative">
            {/* Vertical track */}
            <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-gray-200" />

            <div className="space-y-5">
              {TIMELINE_STEPS.map((step, i) => {
                const isDone    = i <= currentStep
                const isCurrent = i === currentStep

                return (
                  <div key={step.status} className="flex items-start gap-3 relative">
                    {/* Step indicator */}
                    <div className={`
                      h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10
                      ${isDone
                        ? isCurrent
                          ? 'bg-blue-600 text-white'
                          : 'bg-green-500 text-white'
                        : 'bg-white border-2 border-gray-200 text-gray-300'}
                    `}>
                      {isDone && !isCurrent
                        ? <CheckCircle2 className="h-4 w-4" />
                        : isCurrent
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Circle className="h-4 w-4" />
                      }
                    </div>

                    {/* Step text */}
                    <div className="pt-0.5">
                      <p className={`text-sm font-medium ${isDone ? 'text-gray-900' : 'text-gray-400'}`}>
                        {step.label}
                      </p>
                      {isCurrent && (
                        <p className="text-xs text-gray-500 mt-0.5">{step.detail}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resolution note (shown when resolved/closed) */}
      {isResolved && ticket.resolution_note && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-sm font-semibold text-green-800">Resolution</span>
            </div>
            <p className="text-sm text-green-900 leading-relaxed">
              {ticket.resolution_note}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Resolved with no note */}
      {isResolved && !ticket.resolution_note && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-sm text-green-800 font-medium">
              This ticket has been resolved. Thanks for your patience.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Open a new ticket CTA (only when closed) */}
      {ticket.status === 'closed' && (
        <div className="text-center pt-2">
          <p className="text-sm text-gray-500 mb-2">Still having issues?</p>
          <Link href="/support/new">
            <Button variant="outline" size="sm">Open a New Ticket</Button>
          </Link>
        </div>
      )}
    </div>
  )
}
