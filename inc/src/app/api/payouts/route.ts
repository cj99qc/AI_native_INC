import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
// import { getStripe } from '@/lib/stripe' // For future Stripe Connect integration

const schema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('usd'),
  description: z.string().optional()
})

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    // Verify user is vendor or driver
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, email')
      .eq('id', user.id)
      .single()
    
    if (!profile || !['vendor', 'driver'].includes(profile.role)) {
      return NextResponse.json({ error: 'invalid_role' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error }, { status: 400 })
    }

    const { amount, currency } = parsed.data

    // Calculate available earnings for payout
    let availableEarnings = 0
    if (profile.role === 'vendor') {
      // Get vendor earnings from completed orders
      const { data: vendorPayments } = await supabase
        .from('payments')
        .select('vendor_payout')
        .eq('order_id', user.id) // This would need proper join
        .not('vendor_payout', 'is', null)

      availableEarnings = vendorPayments?.reduce((sum, p) => sum + (p.vendor_payout || 0), 0) || 0
    } else if (profile.role === 'driver') {
      // Get driver earnings from completed deliveries
      const { data: driverPayments } = await supabase
        .from('payments')
        .select('driver_payout')
        .not('driver_payout', 'is', null)

      availableEarnings = driverPayments?.reduce((sum, p) => sum + (p.driver_payout || 0), 0) || 0
    }

    // Check for existing pending payouts
    const { data: pendingPayouts } = await supabase
      .from('payouts')
      .select('amount')
      .eq('user_id', user.id)
      .eq('status', 'pending')

    const pendingAmount = pendingPayouts?.reduce((sum, p) => sum + p.amount, 0) || 0
    const availableForPayout = availableEarnings - pendingAmount

    if (amount > availableForPayout) {
      return NextResponse.json({ 
        error: 'insufficient_funds',
        available: availableForPayout,
        requested: amount 
      }, { status: 400 })
    }

    // const stripe = getStripe() // Keep for future Stripe integration

    // In production, you would:
    // 1. Verify the user has a connected Stripe account
    // 2. Create a transfer to their connected account
    // For now, we'll simulate this

    try {
      // Simulate Stripe Connect transfer
      // const transfer = await stripe.transfers.create({
      //   amount: Math.round(amount * 100), // Convert to cents
      //   currency,
      //   destination: userConnectedAccountId,
      //   description: description || `Payout for ${profile.role}`
      // })

      // Create payout record
      const { data: payout, error: payoutError } = await supabase
        .from('payouts')
        .insert({
          user_id: user.id,
          amount,
          stripe_transfer_id: `sim_${Date.now()}`, // Simulated transfer ID
          stripe_connect_account_id: `acct_${user.id.slice(0, 16)}`, // Simulated account ID
          status: 'pending'
        })
        .select()
        .single()

      if (payoutError) {
        return NextResponse.json({ error: 'payout_creation_failed', details: payoutError }, { status: 500 })
      }

      // Log analytics event
      await supabase
        .from('analytics_events')
        .insert({
          user_id: user.id,
          event_type: 'payout_requested',
          data: {
            payout_id: payout.id,
            amount,
            currency,
            role: profile.role,
            available_balance: availableForPayout
          }
        })

      // In production, update payout status after Stripe confirmation
      // For simulation, immediately mark as completed
      await supabase
        .from('payouts')
        .update({ status: 'completed' })
        .eq('id', payout.id)

      return NextResponse.json({
        success: true,
        payout_id: payout.id,
        amount,
        currency,
        status: 'completed', // Would be 'pending' in real implementation
        estimated_arrival: '1-2 business days',
        remaining_balance: availableForPayout - amount
      })

    } catch (stripeError) {
      console.error('Stripe transfer failed:', stripeError)
      return NextResponse.json({ error: 'payment_processing_failed' }, { status: 500 })
    }

  } catch (error) {
    console.error('Payout request error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

// GET endpoint to check available balance
export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (!profile || !['vendor', 'driver'].includes(profile.role)) {
      return NextResponse.json({ error: 'invalid_role' }, { status: 403 })
    }

    // Calculate available earnings
    let totalEarnings = 0
    if (profile.role === 'vendor') {
      const { data: vendorPayments } = await supabase
        .from('payments')
        .select('vendor_payout')
        .not('vendor_payout', 'is', null)

      totalEarnings = vendorPayments?.reduce((sum, p) => sum + (p.vendor_payout || 0), 0) || 0
    } else if (profile.role === 'driver') {
      const { data: driverPayments } = await supabase
        .from('payments')
        .select('driver_payout')
        .not('driver_payout', 'is', null)

      totalEarnings = driverPayments?.reduce((sum, p) => sum + (p.driver_payout || 0), 0) || 0
    }

    // Get pending payouts
    const { data: pendingPayouts } = await supabase
      .from('payouts')
      .select('amount, created_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')

    const pendingAmount = pendingPayouts?.reduce((sum, p) => sum + p.amount, 0) || 0

    // Get payout history
    const { data: payoutHistory } = await supabase
      .from('payouts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      total_earnings: totalEarnings,
      pending_payouts: pendingAmount,
      available_balance: totalEarnings - pendingAmount,
      payout_history: payoutHistory || []
    })

  } catch (error) {
    console.error('Balance check error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}