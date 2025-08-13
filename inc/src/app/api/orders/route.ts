import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data, error } = await supabase.from('orders').select('*').or(`customer_id.eq.${user.id},vendor_id.eq.${user.id}`)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ orders: data })
}

const createSchema = z.object({ vendorId: z.string(), items: z.array(z.object({ productId: z.string(), quantity: z.number().min(1), price: z.number() })) })

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const total = parsed.data.items.reduce((s, i) => s + i.price * i.quantity, 0)
  const { data: order, error } = await supabase.from('orders').insert({ customer_id: user.id, vendor_id: parsed.data.vendorId, status: 'pending', total }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await Promise.all(parsed.data.items.map(i => supabase.from('order_items').insert({ order_id: order!.id, product_id: i.productId, quantity: i.quantity, price: i.price })))
  return NextResponse.json({ order })
}

const updateSchema = z.object({ id: z.string(), status: z.enum(['pending','paid','shipped','delivered','cancelled']) })

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabase()
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { data, error } = await supabase.from('orders').update({ status: parsed.data.status }).eq('id', parsed.data.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ order: data })
}