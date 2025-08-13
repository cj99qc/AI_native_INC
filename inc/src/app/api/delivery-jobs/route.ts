import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('delivery_jobs').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data })
}

const createSchema = z.object({ orderId: z.string(), pickup: z.any(), dropoff: z.any() })

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { data, error } = await supabase.from('delivery_jobs').insert({ order_id: parsed.data.orderId, pickup_location: parsed.data.pickup, dropoff_location: parsed.data.dropoff, status: 'open' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data })
}

const updateSchema = z.object({ id: z.string(), driverId: z.string().optional(), status: z.enum(['open','assigned','in_transit','completed']).optional() })

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabase()
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { data, error } = await supabase.from('delivery_jobs').update({ driver_id: parsed.data.driverId, status: parsed.data.status }).eq('id', parsed.data.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data })
}