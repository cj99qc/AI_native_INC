'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent } from '@/components/ui/card'
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
  Plus,
  ChevronRight,
  Inbox,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

type TicketStatus   = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketCategory = 'missing_item' | 'wrong_item' | 'damaged_item' | 'delivery_delay' | 'driver_behavior' | 'payment_issue' | 'other'

type Ticket = {
  id:          string
  category:    TicketCategory
  description: string
  status:      TicketStatus
  created_at:  string
  order_id:    string | null
}

// ─── Category meta ───────────────────────────────────────────────────────────

const CATEGORY_META: Record<TicketCategory, { label: string; icon: React.ElementType; colour: string }> = {
  missing_item:    { label: 'Missing Item',    icon: Package,       colour: 'text-orange-600 bg-orange-50' },
  wrong_item:      { label: 'Wrong Item',      icon: AlertTriangle, colour: 'text-yellow-600 bg-yellow-50' },
  damaged_item:    { label: 'Damaged Item',    icon: Shield,        colour: 'text-red-600 bg-red-50' },
  delivery_delay:  { label: 'Delivery Delay',  icon: Clock,         colour: 'text-blue-600 bg-blue-50' },
  driver_behavior: { label: 'Driver Issue',    icon: UserX,         colour: 'text-purple-600 bg-purple-50' },
  payment_issue:   { label: 'Payment Issue',   icon: CreditCard,    colour: 'text-green-600 bg-green-50' },
  other:           { label: 'Something Else',  icon: MessageCircle, colour: 'text-gray-600 bg-gray-50' },
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<TicketStatus, { label: string; className: string }> = {
  open:        { label: 'Open',        className: 'bg-blue-100 text-blue-800' },
  in_progress: { label: 'In Progress', className: 'bg-yellow-100 text-yellow-800' },
  resolved:    { label: 'Resolved',    className: 'bg-green-100 text-green-800' },
  closed:      { label: 'Closed',      className: 'bg-gray-100 text-gray-600' },
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const meta = STATUS_BADGE[status]
  return (
    <Badge className={`text-xs font-medium ${meta.className}`}>
      {meta.label}
    </Badge>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SupportPage() {
  const router   = useRouter()
  const supabase = useSupabase()
  const { user } = useAuth()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<TicketStatus | 'all'>('all')

  const fetchTickets = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      let query = supabase
        .from('support_tickets')
        .select('id, category, description, status, created_at, order_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      const { data, error } = await query
      if (error) throw error
      setTickets((data ?? []) as Ticket[])
    } catch (err) {
      console.error('Failed to fetch tickets:', err)
    } finally {
      setLoading(false)
    }
  }, [user, supabase, filter])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  // ── Filter tabs ────────────────────────────────────────────────────────────
  const FILTERS: { value: TicketStatus | 'all'; label: string }[] = [
    { value: 'all',         label: 'All' },
    { value: 'open',        label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'resolved',    label: 'Resolved' },
    { value: 'closed',      label: 'Closed' },
  ]

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
          <div className="h-9 w-32 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-20 bg-gray-100 rounded-full animate-pulse" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  const isEmpty = tickets.length === 0

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-12">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Support</h1>
          <p className="text-sm text-gray-600">Your help requests</p>
        </div>
        <Link href="/support/new">
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Ticket
          </Button>
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`
              shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors
              ${filter === f.value
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
            `}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center">
            <Inbox className="h-7 w-7 text-gray-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-700">
              {filter === 'all' ? 'No tickets yet' : `No ${STATUS_BADGE[filter as TicketStatus]?.label.toLowerCase()} tickets`}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {filter === 'all'
                ? 'Something wrong with an order? We\'ll sort it out fast.'
                : 'Try switching the filter above.'}
            </p>
          </div>
          {filter === 'all' && (
            <Link href="/support/new">
              <Button variant="outline" size="sm">Get Help</Button>
            </Link>
          )}
        </div>
      )}

      {/* Ticket list */}
      {!isEmpty && (
        <div className="space-y-3">
          {tickets.map(ticket => {
            const meta = CATEGORY_META[ticket.category]
            const Icon = meta.icon
            const age  = formatAge(ticket.created_at)

            return (
              <Link key={ticket.id} href={`/tickets/${ticket.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer border-gray-200">
                  <CardContent className="p-4 flex items-center gap-3">

                    {/* Category icon */}
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${meta.colour}`}>
                      <Icon className="h-5 w-5" />
                    </div>

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{meta.label}</span>
                        <StatusBadge status={ticket.status} />
                      </div>
                      <p className="text-sm text-gray-600 truncate mt-0.5">{ticket.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">{age}</span>
                        {ticket.order_id && (
                          <>
                            <span className="text-gray-300">·</span>
                            <span className="text-xs text-gray-400">
                              Order #{ticket.order_id.slice(-8)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Chevron */}
                    <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)

  if (mins  < 1)   return 'Just now'
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  < 7)   return `${days}d ago`
  return new Date(isoDate).toLocaleDateString()
}
