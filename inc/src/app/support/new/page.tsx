'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Package,
  AlertTriangle,
  Shield,
  Clock,
  UserX,
  CreditCard,
  MessageCircle,
  MapPin,
  CheckCircle2,
  ArrowLeft,
  ChevronRight,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Zap,
} from 'lucide-react'
import Link from 'next/link'

// ─── Category definitions ─────────────────────────────────────────────────────

const CATEGORIES = [
  {
    value:       'missing_item',
    label:       'Missing Item',
    description: "Something wasn't in your order",
    icon:        Package,
    colour:      'text-orange-600 bg-orange-50 border-orange-200',
    selected:    'border-orange-500 bg-orange-50 ring-2 ring-orange-300',
  },
  {
    value:       'wrong_item',
    label:       'Wrong Item',
    description: 'You received something different',
    icon:        AlertTriangle,
    colour:      'text-yellow-600 bg-yellow-50 border-yellow-200',
    selected:    'border-yellow-500 bg-yellow-50 ring-2 ring-yellow-300',
  },
  {
    value:       'damaged_item',
    label:       'Damaged Item',
    description: 'Item arrived broken or spoiled',
    icon:        Shield,
    colour:      'text-red-600 bg-red-50 border-red-200',
    selected:    'border-red-500 bg-red-50 ring-2 ring-red-300',
  },
  {
    value:       'delivery_delay',
    label:       'Delivery Delay',
    description: 'Order is taking too long',
    icon:        Clock,
    colour:      'text-blue-600 bg-blue-50 border-blue-200',
    selected:    'border-blue-500 bg-blue-50 ring-2 ring-blue-300',
  },
  {
    value:       'driver_behavior',
    label:       'Driver Issue',
    description: 'Problem with your driver',
    icon:        UserX,
    colour:      'text-purple-600 bg-purple-50 border-purple-200',
    selected:    'border-purple-500 bg-purple-50 ring-2 ring-purple-300',
  },
  {
    value:       'payment_issue',
    label:       'Payment Issue',
    description: 'Charge or refund problem',
    icon:        CreditCard,
    colour:      'text-green-600 bg-green-50 border-green-200',
    selected:    'border-green-500 bg-green-50 ring-2 ring-green-300',
  },
  {
    value:       'other',
    label:       'Something Else',
    description: 'Any other issue',
    icon:        MessageCircle,
    colour:      'text-gray-600 bg-gray-50 border-gray-200',
    selected:    'border-gray-500 bg-gray-50 ring-2 ring-gray-300',
  },
] as const

type CategoryValue = typeof CATEGORIES[number]['value']

type OrderPreview = {
  id:     string
  status: string
  total:  number
}

type RagSuggestion = {
  solution:  string
  score:     number
  source:    string
  result_id: string
}

// Submit phases drive the post-submission UI
type Phase =
  | 'idle'           // form visible
  | 'creating'       // ticket creation in flight
  | 'checking_rag'   // ticket created, RAG query in flight
  | 'suggestion'     // RAG returned a high-confidence match
  | 'accepting'      // user clicked "Yes", auto-resolve in flight
  | 'auto_resolved'  // accepted — ticket resolved instantly
  | 'submitted'      // normal success (no match or declined)

// ─── Confidence label ─────────────────────────────────────────────────────────

function confidenceLabel(score: number): { label: string; colour: string } {
  if (score >= 0.85) return { label: 'Excellent match',  colour: 'text-green-600' }
  if (score >= 0.75) return { label: 'Strong match',     colour: 'text-blue-600' }
  return                    { label: 'Possible match',   colour: 'text-amber-600' }
}

// ─── Inner form ───────────────────────────────────────────────────────────────

function NewTicketForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = useSupabase()
  const { user }     = useAuth()

  const orderIdParam = searchParams.get('order_id')

  const [category,       setCategory]       = useState<CategoryValue | null>(null)
  const [description,    setDescription]    = useState('')
  const [order,          setOrder]          = useState<OrderPreview | null>(null)
  const [location,       setLocation]       = useState<{ lat: number; lng: number } | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [phase,          setPhase]          = useState<Phase>('idle')
  const [submitError,    setSubmitError]    = useState<string | null>(null)
  const [createdTicketId,setCreatedTicketId]= useState<string | null>(null)
  const [ragSuggestion,  setRagSuggestion]  = useState<RagSuggestion | null>(null)

  // ── Pre-populate order ────────────────────────────────────────────────────
  const fetchOrder = useCallback(async () => {
    if (!orderIdParam || !user) return
    const { data } = await supabase
      .from('orders')
      .select('id, status, total')
      .eq('id', orderIdParam)
      .eq('customer_id', user.id)
      .single()
    if (data) setOrder(data)
  }, [orderIdParam, user, supabase])

  useEffect(() => { fetchOrder() }, [fetchOrder])

  // ── Geolocation ───────────────────────────────────────────────────────────
  const requestLocation = () => {
    if (!('geolocation' in navigator)) { setLocationStatus('denied'); return }
    setLocationStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocationStatus('granted')
      },
      () => setLocationStatus('denied')
    )
  }

  // ── RAG query (non-blocking, 5s timeout) ──────────────────────────────────
  const queryRag = async (cat: CategoryValue, desc: string): Promise<RagSuggestion | null> => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const res = await fetch('/api/support/rag-suggest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category: cat, description: desc }),
        signal:  controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) return null
      const data = await res.json()
      return data.suggestion ?? null
    } catch {
      return null   // timeout or bridge down → degrade gracefully
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!category || description.trim().length < 10) return
    setPhase('creating')
    setSubmitError(null)

    try {
      // Step 1: Create the ticket
      const res = await fetch('/api/support/tickets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          description,
          order_id:     orderIdParam ?? null,
          location_lat: location?.lat ?? null,
          location_lng: location?.lng ?? null,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Submission failed')
      }

      const ticket = await res.json()
      setCreatedTicketId(ticket.id)

      // Step 2: Query RAG while showing "checking" state
      setPhase('checking_rag')
      const suggestion = await queryRag(category, description)

      if (suggestion) {
        setRagSuggestion(suggestion)
        setPhase('suggestion')
      } else {
        setPhase('submitted')
        setTimeout(() => router.push('/support'), 2800)
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong')
      setPhase('idle')
    }
  }

  // ── Accept RAG suggestion → auto-resolve ─────────────────────────────────
  const handleAccept = async () => {
    if (!createdTicketId || !ragSuggestion) return
    setPhase('accepting')
    try {
      const res = await fetch(`/api/support/tickets/${createdTicketId}/auto-resolve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ resolution_note: ragSuggestion.solution }),
      })
      if (!res.ok) throw new Error('Auto-resolve failed')
      setPhase('auto_resolved')
      setTimeout(() => router.push('/support'), 3200)
    } catch {
      // Fallback: degrade to normal success — ticket stays open
      setPhase('submitted')
      setTimeout(() => router.push('/support'), 2800)
    }
  }

  // ── Decline RAG suggestion ────────────────────────────────────────────────
  const handleDecline = () => {
    setPhase('submitted')
    setTimeout(() => router.push('/support'), 2800)
  }

  const selectedCat = CATEGORIES.find(c => c.value === category)
  const canSubmit   = !!category && description.trim().length >= 10

  // ── Post-submit phases ────────────────────────────────────────────────────

  // Checking RAG — ticket created, scanning knowledge base
  if (phase === 'checking_rag' || phase === 'creating') {
    return (
      <div className="mx-auto max-w-xl flex flex-col items-center justify-center min-h-[60vh] gap-5 p-4 text-center">
        <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-blue-500 animate-pulse" />
        </div>
        <div>
          <h2 className="text-xl font-bold">
            {phase === 'creating' ? 'Submitting…' : 'Ticket submitted'}
          </h2>
          <p className="text-gray-500 mt-1 text-sm">
            {phase === 'creating'
              ? 'Creating your ticket…'
              : 'Scanning our knowledge base for an instant fix…'}
          </p>
        </div>
        <div className="flex gap-1.5">
          {[0, 150, 300].map(delay => (
            <div
              key={delay}
              className="h-2 w-2 bg-blue-400 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    )
  }

  // RAG suggestion — anticipatory solution intercept
  if (phase === 'suggestion' && ragSuggestion) {
    const conf = confidenceLabel(ragSuggestion.score)
    return (
      <div className="mx-auto max-w-xl flex flex-col items-center gap-5 p-4 py-10 text-center">
        {/* Icon */}
        <div className="h-16 w-16 rounded-full bg-indigo-100 flex items-center justify-center">
          <Zap className="h-8 w-8 text-indigo-600" />
        </div>

        {/* Headline */}
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${conf.colour}`}>
            {conf.label} · {Math.round(ragSuggestion.score * 100)}% confidence
          </p>
          <h2 className="text-2xl font-bold">We've seen this before</h2>
          <p className="text-gray-500 text-sm mt-1">
            Your ticket is saved. Here's what solved it last time:
          </p>
        </div>

        {/* Proposed solution card */}
        <Card className="w-full border-indigo-200 bg-indigo-50 text-left">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-indigo-800 mb-1.5 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Proposed solution
            </p>
            <p className="text-sm text-indigo-900 leading-relaxed">
              {ragSuggestion.solution}
            </p>
          </CardContent>
        </Card>

        {/* CTA */}
        <p className="text-gray-700 font-medium">Would this solve your issue right now?</p>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <Button
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={handleAccept}
          >
            <ThumbsUp className="h-4 w-4 mr-2" />
            Yes — close my ticket
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDecline}
          >
            <ThumbsDown className="h-4 w-4 mr-2" />
            No, keep it open
          </Button>
        </div>

        <p className="text-xs text-gray-400">
          Declining keeps your ticket open for our support team.
        </p>
      </div>
    )
  }

  // Accepting RAG solution — auto-resolving in flight
  if (phase === 'accepting') {
    return (
      <div className="mx-auto max-w-xl flex flex-col items-center justify-center min-h-[60vh] gap-4 p-4 text-center">
        <div className="h-16 w-16 rounded-full bg-indigo-100 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-indigo-500 animate-pulse" />
        </div>
        <h2 className="text-xl font-bold">Applying solution…</h2>
        <div className="flex gap-1.5">
          {[0, 150, 300].map(delay => (
            <div
              key={delay}
              className="h-2 w-2 bg-indigo-400 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    )
  }

  // Auto-resolved — the fastest possible support experience
  if (phase === 'auto_resolved') {
    return (
      <div className="mx-auto max-w-xl flex flex-col items-center justify-center min-h-[60vh] gap-4 p-4 text-center">
        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold">Solved in seconds</h2>
        <p className="text-gray-600 max-w-sm">
          Your ticket has been marked resolved. No waiting, no back-and-forth.
        </p>
        <p className="text-sm text-gray-400">Redirecting to your tickets…</p>
      </div>
    )
  }

  // Normal success — no RAG match or user declined
  if (phase === 'submitted') {
    return (
      <div className="mx-auto max-w-xl flex flex-col items-center justify-center min-h-[60vh] gap-4 p-4 text-center">
        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold">We're on it</h2>
        <p className="text-gray-600 max-w-sm">
          Your ticket has been submitted. We'll update you as soon as we have news.
        </p>
        <p className="text-sm text-gray-400">Redirecting to your tickets…</p>
      </div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-12">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/support">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Get Help</h1>
          <p className="text-sm text-gray-600">Tell us what happened — we'll sort it out</p>
        </div>
      </div>

      {/* Linked order banner */}
      {order && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-900">
                  Linked to Order #{order.id.slice(-8)}
                </p>
                <p className="text-xs text-blue-700 capitalize">
                  {order.status} · ${order.total.toFixed(2)}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-blue-400" />
          </CardContent>
        </Card>
      )}

      {/* Step 1 — Category */}
      <div className="space-y-3">
        <p className="font-semibold text-gray-800">What happened?</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CATEGORIES.map(cat => {
            const Icon     = cat.icon
            const isActive = category === cat.value
            return (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`
                  flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left
                  transition-all duration-150 cursor-pointer
                  ${isActive ? cat.selected : `${cat.colour} hover:opacity-90`}
                `}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="text-sm font-semibold leading-tight">{cat.label}</span>
                <span className="text-xs opacity-70 leading-tight">{cat.description}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Step 2 — Description */}
      {category && (
        <div className="space-y-2">
          <p className="font-semibold text-gray-800">
            Tell us more about your {selectedCat?.label.toLowerCase()}
          </p>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder={`Describe what happened with your ${selectedCat?.label.toLowerCase()}…`}
            className="
              w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400
              resize-none placeholder:text-gray-400
            "
          />
          <p className={`text-xs ${description.trim().length < 10 ? 'text-gray-400' : 'text-green-600'}`}>
            {description.trim().length < 10
              ? `${10 - description.trim().length} more characters needed`
              : 'Looks good'}
          </p>
        </div>
      )}

      {/* Step 3 — Location (soft nudge) */}
      {category && (
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-800">Share your location</p>
                <p className="text-xs text-gray-500">Helps us resolve this faster</p>
              </div>
            </div>
            {locationStatus === 'idle' && (
              <Button variant="outline" size="sm" onClick={requestLocation}>Allow</Button>
            )}
            {locationStatus === 'requesting' && (
              <span className="text-xs text-gray-400 animate-pulse">Requesting…</span>
            )}
            {locationStatus === 'granted' && (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Shared
              </span>
            )}
            {locationStatus === 'denied' && (
              <span className="text-xs text-gray-400">Skipped</span>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {submitError && (
        <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {submitError}
        </p>
      )}

      {/* RAG hint — reassures user that instant answers may be waiting */}
      {canSubmit && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Sparkles className="h-3 w-3" />
          We'll check our knowledge base for an instant fix
        </div>
      )}

      {/* Submit */}
      {category && (
        <Button
          className="w-full"
          disabled={!canSubmit || phase !== 'idle'}
          onClick={handleSubmit}
        >
          Submit Ticket
        </Button>
      )}
    </div>
  )
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function NewTicketPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          <div className="h-8 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      }
    >
      <NewTicketForm />
    </Suspense>
  )
}
