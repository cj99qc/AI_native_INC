import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// ─── Risk thresholds ──────────────────────────────────────────────────────────
// These mirror the Pulse matching engine scoring bands.

const LOW_MATCH_THRESHOLD       = 0.5  // match_score below this = risk
const LOW_TRAJECTORY_THRESHOLD  = 0.4  // trajectory_score below this = deviation risk

// ─── GET /api/admin/support/pulse-context?order_id=xxx ───────────────────────
// Returns Pulse matching context for the delivery job linked to an order.
// Used by admin support queue to surface friction signals.

export async function GET(req: Request) {
  const supabase = await createServerSupabase()

  // Admin only
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

  const { searchParams } = new URL(req.url)
  const orderId = searchParams.get('order_id')
  if (!orderId) {
    return NextResponse.json({ error: 'order_id required' }, { status: 400 })
  }

  // ── Step 1: Get delivery job to resolve driver_id ─────────────────────────
  const { data: job } = await supabase
    .from('delivery_jobs')
    .select('id, driver_id, batch_id, status')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!job?.driver_id) {
    // No delivery job or no driver assigned yet — nothing to surface
    return NextResponse.json({
      pulse:         null,
      driver_status: null,
      risk_level:    'unknown',
      reason:        'No driver assigned',
    })
  }

  // ── Step 2: Parallel fetch driver_status + pulse_matches ──────────────────
  const [statusResult, pulseResult] = await Promise.all([
    supabase
      .from('driver_status')
      .select('status, latitude, longitude, speed_kmh, heading_degrees, updated_at')
      .eq('driver_id', job.driver_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single(),

    supabase
      .from('pulse_matches')
      .select('match_score, trajectory_score, artery_score, distance_km, estimated_acceptance_probability, match_details, suggested_at')
      .eq('driver_id', job.driver_id)
      .order('suggested_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  const driverStatus = statusResult.data ?? null
  const pulseMatch   = pulseResult.data ?? null

  // ── Step 3: Compute risk level ─────────────────────────────────────────────
  let riskLevel: 'high' | 'medium' | 'low' | 'unknown' = 'unknown'
  let riskReason = ''

  if (pulseMatch) {
    const lowScore      = pulseMatch.match_score      < LOW_MATCH_THRESHOLD
    const lowTrajectory = (pulseMatch.trajectory_score ?? 1) < LOW_TRAJECTORY_THRESHOLD
    const driverOffline = driverStatus?.status === 'offline'

    if (lowScore || lowTrajectory || driverOffline) {
      riskLevel  = 'high'
      const reasons: string[] = []
      if (lowScore)      reasons.push(`Low match score (${(pulseMatch.match_score * 100).toFixed(0)}%)`)
      if (lowTrajectory) reasons.push('Driver deviated from route')
      if (driverOffline) reasons.push('Driver went offline')
      riskReason = reasons.join(' · ')
    } else if (pulseMatch.match_score < 0.7) {
      riskLevel  = 'medium'
      riskReason = `Moderate match score (${(pulseMatch.match_score * 100).toFixed(0)}%)`
    } else {
      riskLevel  = 'low'
      riskReason = 'All signals nominal'
    }
  } else if (driverStatus) {
    // Have driver location but no Pulse data — mild unknown risk
    riskLevel  = 'medium'
    riskReason = 'No Pulse match data available'
  }

  return NextResponse.json({
    pulse:         pulseMatch,
    driver_status: driverStatus,
    job_status:    job.status,
    risk_level:    riskLevel,
    reason:        riskReason,
  })
}
