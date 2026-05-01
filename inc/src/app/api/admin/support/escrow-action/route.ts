import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001'

// ─── POST /api/admin/support/escrow-action ────────────────────────────────────
// Admin-only shortcut to call the escrow service's release or refund endpoints
// directly from the support queue, enabling rapid resolution.
//
// Body:
//   { escrow_id: string, action: 'release' | 'refund', refund_reason?: string }

export async function POST(req: Request) {
  const supabase = await createServerSupabase()

  // Admin guard
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { escrow_id, action, refund_reason } = body

  if (typeof escrow_id !== 'string' || !escrow_id) {
    return NextResponse.json({ error: 'escrow_id is required' }, { status: 400 })
  }

  if (action !== 'release' && action !== 'refund') {
    return NextResponse.json({ error: 'action must be "release" or "refund"' }, { status: 400 })
  }

  // ── Relay to bridge ────────────────────────────────────────────────────────
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    let bridgeUrl: string
    let bridgeBody: Record<string, unknown>

    if (action === 'release') {
      bridgeUrl  = `${BRIDGE_URL}/api/escrow/release`
      bridgeBody = {
        escrow_id,
        completion_confirmed: true,
        completion_notes:     `Released by admin support queue (user ${user.id})`,
      }
    } else {
      bridgeUrl  = `${BRIDGE_URL}/api/escrow/refund`
      bridgeBody = {
        escrow_id,
        refund_reason: typeof refund_reason === 'string' && refund_reason.trim()
          ? refund_reason.trim()
          : 'Admin-initiated refund via support queue',
      }
    }

    const res = await fetch(bridgeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(bridgeBody),
      signal:  controller.signal,
    })
    clearTimeout(timer)

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error ?? data.detail ?? 'Escrow action failed' },
        { status: res.status }
      )
    }

    return NextResponse.json({ success: true, action, ...data })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Bridge timeout' }, { status: 504 })
    }
    return NextResponse.json({ error: 'Bridge unreachable' }, { status: 502 })
  }
}
