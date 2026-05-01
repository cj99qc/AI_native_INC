import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001'

// ─── GET /api/support/tickets/[id]/escrow ────────────────────────────────────
// Returns escrow state for the order linked to this ticket.
// Only accessible by the ticket owner or an admin.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabase()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch the ticket and verify ownership (admins bypass via RLS)
  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, order_id, user_id, status')
    .eq('id', id)
    .single()

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // Verify caller is the ticket owner or an admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  if (ticket.user_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // No linked order — return null escrow
  if (!ticket.order_id) {
    return NextResponse.json({ escrow: null })
  }

  // Fetch escrow from bridge → escrow service
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(`${BRIDGE_URL}/api/escrow/order/${ticket.order_id}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json({ escrow: null })
    }

    const data = await res.json()
    // Return the most recent escrow record (first = newest, sorted DESC in service)
    const latest = data.escrows?.[0] ?? null
    return NextResponse.json({ escrow: latest, order_id: ticket.order_id })
  } catch {
    // Bridge unreachable — degrade gracefully
    return NextResponse.json({ escrow: null })
  }
}
