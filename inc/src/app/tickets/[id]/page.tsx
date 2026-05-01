'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  Lock,
  ShieldCheck,
  Send,
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

type EscrowRecord = {
  escrow_id:   string
  status:      'pending' | 'held' | 'released' | 'disputed' | 'refunded'
  total_cents: number
  created_at:  string
}

type Message = {
  id:          string
  sender_id:   string
  sender_role: string
  body:        string
  created_at:  string
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
  open:        { label: 'Open',        badge: 'bg-blue-100 text-blue-800',     step: 0 },
  in_progress: { label: 'In Progress', badge: 'bg-yellow-100 text-yellow-800', step: 1 },
  resolved:    { label: 'Resolved',    badge: 'bg-green-100 text-green-800',   step: 2 },
  closed:      { label: 'Closed',      badge: 'bg-gray-100 text-gray-600',     step: 3 },
}

const TIMELINE_STEPS: { status: TicketStatus; label: string; detail: string }[] = [
  { status: 'open',        label: 'Submitted',   detail: 'We received your ticket' },
  { status: 'in_progress', label: 'In Progress', detail: 'Our team is looking into this' },
  { status: 'resolved',    label: 'Resolved',    detail: 'Issue has been addressed' },
  { status: 'closed',      label: 'Closed',      detail: 'Ticket closed' },
]

// ─── Escrow banner ────────────────────────────────────────────────────────────

function HandshakeBanner({ escrow, ticketStatus }: { escrow: EscrowRecord; ticketStatus: TicketStatus }) {
  const isActive = escrow.status === 'held' || escrow.status === 'disputed'
  const isPaused = ticketStatus === 'open' || ticketStatus === 'in_progress'

  if (!isActive) return null

  const totalFormatted = (escrow.total_cents / 100).toFixed(2)

  return (
    <Card className={`border-2 ${isPaused ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
            isPaused ? 'bg-amber-100' : 'bg-green-100'
          }`}>
            {isPaused
              ? <Lock className="h-5 w-5 text-amber-600" />
              : <ShieldCheck className="h-5 w-5 text-green-600" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-semibold text-sm ${isPaused ? 'text-amber-900' : 'text-green-900'}`}>
              {isPaused
                ? 'The Handshake is paused — funds are secured in escrow until this is resolved'
                : escrow.status === 'disputed'
                  ? 'Payment is under dispute'
                  : 'Funds held securely'}
            </p>
            <p className={`text-xs mt-1 ${isPaused ? 'text-amber-700' : 'text-green-700'}`}>
              ${totalFormatted} secured · Escrow status:{' '}
              <span className="font-medium capitalize">{escrow.status}</span>
            </p>
            {isPaused && (
              <p className="text-xs text-amber-600 mt-1.5">
                No payment will be released to any party while your ticket is open. We'll update you once resolved.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Message thread ───────────────────────────────────────────────────────────

function MessageThread({
  messages,
  currentUserId,
  ticketStatus,
  ticketId,
  onMessageSent,
}: {
  messages:      Message[]
  currentUserId: string
  ticketStatus:  TicketStatus
  ticketId:      string
  onMessageSent: (msg: Message) => void
}) {
  const [draft,    setDraft]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isClosed  = ticketStatus === 'closed'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: text }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to send')
      }
      const msg: Message = await res.json()
      onMessageSent(msg)
      setDraft('')
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-blue-500" />
          Support Thread
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">

        {/* Message list */}
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">
              No messages yet. Send us a message below.
            </p>
          )}
          {messages.map(msg => {
            const isMe     = msg.sender_id === currentUserId
            const isAdmin  = msg.sender_role === 'admin'
            const isSystem = msg.sender_role === 'system'

            if (isSystem) {
              return (
                <div key={msg.id} className="text-center">
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">
                    {msg.body}
                  </span>
                </div>
              )
            }

            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`
                  max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
                  ${isMe
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : isAdmin
                    ? 'bg-gray-900 text-white rounded-bl-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'}
                `}>
                  {!isMe && (
                    <p className={`text-xs font-semibold mb-1 ${isAdmin ? 'text-blue-300' : 'text-gray-500'}`}>
                      {isAdmin ? 'Support Team' : 'You'}
                    </p>
                  )}
                  <p>{msg.body}</p>
                  <p className={`text-xs mt-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        {!isClosed && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex gap-2 items-end">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                disabled={sending}
                placeholder="Type a message… (Enter to send)"
                className="
                  flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400
                  resize-none placeholder:text-gray-400 disabled:opacity-60
                "
              />
              <Button
                size="sm"
                onClick={sendMessage}
                disabled={!draft.trim() || sending}
                className="shrink-0 h-10 w-10 p-0"
              >
                {sending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />
                }
              </Button>
            </div>
            {sendError && (
              <p className="text-xs text-red-600">{sendError}</p>
            )}
          </div>
        )}

        {isClosed && (
          <p className="text-xs text-gray-400 text-center border-t pt-3">
            This ticket is closed. Open a new ticket if you need further help.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TicketDetailPage() {
  const params   = useParams()
  const id       = params.id as string
  const supabase = useSupabase()
  const { user } = useAuth()

  const [ticket,   setTicket]   = useState<Ticket | null>(null)
  const [escrow,   setEscrow]   = useState<EscrowRecord | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!user || !id) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('id, category, description, status, created_at, updated_at, order_id, resolution_note')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error || !data) { setNotFound(true); return }
      setTicket(data as Ticket)

      // Parallel: fetch escrow state + messages
      const [escrowRes, messagesRes] = await Promise.all([
        fetch(`/api/support/tickets/${id}/escrow`, { cache: 'no-store' }),
        fetch(`/api/support/tickets/${id}/messages`, { cache: 'no-store' }),
      ])

      if (escrowRes.ok) {
        const escrowData = await escrowRes.json()
        setEscrow(escrowData.escrow ?? null)
      }

      if (messagesRes.ok) {
        const msgData = await messagesRes.json()
        setMessages(msgData.messages ?? [])
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [user, id, supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleMessageSent = (msg: Message) => {
    setMessages(prev => [...prev, msg])
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="h-8 w-40 bg-gray-200 rounded animate-pulse" />
        <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    )
  }

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

  const catMeta     = CATEGORY_META[ticket.category]
  const statusMeta  = STATUS_META[ticket.status]
  const Icon        = catMeta.icon
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

      {/* Handshake escrow banner — shown when ticket is open + funds are held */}
      {escrow && (
        <HandshakeBanner escrow={escrow} ticketStatus={ticket.status} />
      )}

      {/* Summary card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${catMeta.colour}`}>
                <Icon className="h-4 w-4" />
              </div>
              <span className="font-semibold text-gray-900">{catMeta.label}</span>
            </div>
            <Badge className={`text-xs font-medium ${statusMeta.badge}`}>
              {statusMeta.label}
            </Badge>
          </div>

          <p className="text-sm text-gray-700 leading-relaxed border-t pt-3">
            {ticket.description}
          </p>

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
            <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-gray-200" />
            <div className="space-y-5">
              {TIMELINE_STEPS.map((step, i) => {
                const isDone    = i <= currentStep
                const isCurrent = i === currentStep
                return (
                  <div key={step.status} className="flex items-start gap-3 relative">
                    <div className={`
                      h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10
                      ${isDone
                        ? isCurrent ? 'bg-blue-600 text-white' : 'bg-green-500 text-white'
                        : 'bg-white border-2 border-gray-200 text-gray-300'}
                    `}>
                      {isDone && !isCurrent
                        ? <CheckCircle2 className="h-4 w-4" />
                        : isCurrent
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Circle className="h-4 w-4" />
                      }
                    </div>
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

      {/* Resolution note */}
      {isResolved && ticket.resolution_note && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-sm font-semibold text-green-800">Resolution</span>
            </div>
            <p className="text-sm text-green-900 leading-relaxed">{ticket.resolution_note}</p>
          </CardContent>
        </Card>
      )}

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

      {/* Message thread */}
      {user && (
        <MessageThread
          messages={messages}
          currentUserId={user.id}
          ticketStatus={ticket.status}
          ticketId={ticket.id}
          onMessageSent={handleMessageSent}
        />
      )}

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
