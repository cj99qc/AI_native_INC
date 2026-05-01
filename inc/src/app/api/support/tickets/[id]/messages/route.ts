import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Message = {
  id: string
  ticket_id: string
  sender_id: string
  sender_role: string
  body: string
  created_at: string
}

// ─── GET /api/support/tickets/[id]/messages ───────────────────────────────────
// Returns all messages for a ticket ordered chronologically.

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

  // RLS handles ownership — ticket_messages_select_own / ticket_messages_admin_all
  const { data, error } = await supabase
    .from('ticket_messages')
    .select('id, ticket_id, sender_id, sender_role, body, created_at')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ messages: (data ?? []) as Message[] })
}

// ─── POST /api/support/tickets/[id]/messages ──────────────────────────────────
// Appends a message to the ticket thread.
// Body: { body: string }

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

  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
  }

  // Resolve sender role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const senderRole = profile?.role ?? 'customer'

  // Verify the ticket exists (RLS will block if not owner/admin)
  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, status')
    .eq('id', id)
    .single()

  if (!ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  if (ticket.status === 'closed') {
    return NextResponse.json({ error: 'Cannot reply to a closed ticket' }, { status: 400 })
  }

  const { data: msg, error: insertError } = await supabase
    .from('ticket_messages')
    .insert({
      ticket_id:   id,
      sender_id:   user.id,
      sender_role: senderRole,
      body:        text,
    })
    .select('id, ticket_id, sender_id, sender_role, body, created_at')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json(msg, { status: 201 })
}
