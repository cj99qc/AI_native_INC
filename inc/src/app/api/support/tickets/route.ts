import { NextResponse }         from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Valid categories mirror the ticket_category enum in schema.sql
const VALID_CATEGORIES = [
  'missing_item',
  'wrong_item',
  'damaged_item',
  'delivery_delay',
  'driver_behavior',
  'payment_issue',
  'other',
] as const

type Category = typeof VALID_CATEGORIES[number]

function isValidCategory(v: unknown): v is Category {
  return VALID_CATEGORIES.includes(v as Category)
}

// ─── POST /api/support/tickets ────────────────────────────────────────────────
// Creates a new support ticket for the authenticated user.
// Body: { category, description, order_id?, location_lat?, location_lng? }

export async function POST(req: Request) {
  const supabase = await createServerSupabase()

  // Require authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { category, description, order_id, location_lat, location_lng } = body

  // Validate required fields
  if (!isValidCategory(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` },
      { status: 400 }
    )
  }

  if (typeof description !== 'string' || description.trim().length < 10) {
    return NextResponse.json(
      { error: 'description must be at least 10 characters' },
      { status: 400 }
    )
  }

  // If order_id provided, verify the order belongs to the submitting user
  if (order_id) {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('id', order_id)
      .eq('customer_id', user.id)
      .single()

    if (!order) {
      return NextResponse.json({ error: 'Order not found or not yours' }, { status: 403 })
    }
  }

  // Insert ticket — lat/lng trigger computes the geography column
  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id:      user.id,
      category,
      description:  description.trim(),
      order_id:     order_id   ?? null,
      location_lat: typeof location_lat === 'number' ? location_lat : null,
      location_lng: typeof location_lng === 'number' ? location_lng : null,
    })
    .select('id, status, created_at')
    .single()

  if (error) {
    console.error('Ticket insert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
