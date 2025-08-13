import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createServerSupabase } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 })
  }

  const supabase = await createServerSupabase()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const amount = (session.amount_total ?? 0) / 100
      // Mark orders as paid for vendors in metadata
      const vendors: string[] = session.metadata?.vendors ? JSON.parse(session.metadata.vendors) : []
      for (const vendorId of vendors) {
        const { data: orders } = await supabase
          .from('orders')
          .update({ status: 'paid' })
          .eq('vendor_id', vendorId)
          .eq('status', 'pending')
          .select('id')
        for (const o of orders ?? []) {
          await supabase.from('payments').insert({ order_id: o.id, stripe_session_id: session.id, amount, status: 'paid' })
          await supabase.from('delivery_jobs').insert({ order_id: o.id, pickup_location: '{}', dropoff_location: '{}', status: 'open' })
        }
      }
      break
    }
  }
  return NextResponse.json({ received: true })
}

export const dynamic = 'force-dynamic'