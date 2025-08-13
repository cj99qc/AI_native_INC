import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getStripe } from '@/lib/stripe'
import { createServerSupabase } from '@/lib/supabase/server'

const schema = z.object({
  items: z.array(
    z.object({ productId: z.string(), vendorId: z.string(), name: z.string(), price: z.number(), quantity: z.number().min(1) })
  ),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  const stripe = getStripe()
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Group by vendor
  const byVendor = new Map<string, typeof parsed.data.items>()
  for (const item of parsed.data.items) {
    const arr = byVendor.get(item.vendorId) ?? []
    arr.push(item)
    byVendor.set(item.vendorId, arr)
  }

  // Create a single session for demo
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: parsed.data.items.map(i => ({
      price_data: { currency: 'usd', product_data: { name: i.name }, unit_amount: Math.round(i.price * 100) },
      quantity: i.quantity,
    })),
    success_url: `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/orders`,
    cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'}/cart`,
    metadata: { vendors: JSON.stringify(Array.from(byVendor.keys())) },
  })

  // Insert a pending order per vendor
  for (const [vendorId, items] of byVendor) {
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0)
    const { data: order } = await supabase
      .from('orders')
      .insert({ customer_id: user.id, vendor_id: vendorId, status: 'pending', total })
      .select('*')
      .single()
    if (order) {
      await Promise.all(
        items.map(i => supabase.from('order_items').insert({ order_id: order.id, product_id: i.productId, quantity: i.quantity, price: i.price }))
      )
    }
  }

  return NextResponse.json({ url: session.url })
}