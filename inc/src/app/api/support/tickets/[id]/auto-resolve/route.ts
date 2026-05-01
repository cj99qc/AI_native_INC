import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// ─── POST /api/support/tickets/[id]/auto-resolve ──────────────────────────────
// Marks a ticket 'resolved' when the user accepts a RAG-suggested solution.
// Only the ticket owner may call this, and only on open/in_progress tickets.
//
// Body: { resolution_note: string }

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabase()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const resolution_note =
    typeof body.resolution_note === 'string' ? body.resolution_note.trim() : ''

  // Fetch and verify ownership + eligibility
  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, user_id, status')
    .eq('id', id)
    .single()

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }
  if (ticket.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    // Already resolved — idempotent success
    return NextResponse.json({ id: ticket.id, status: ticket.status })
  }

  const { data, error } = await supabase
    .from('support_tickets')
    .update({
      status:          'resolved',
      resolution_note: resolution_note || 'Resolved via RAG-suggested solution',
      resolved_at:     new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, status, resolved_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
