import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const CREATE_SERVICE_SCHEMA = z.object({
  service_slug: z.string().min(1, 'Service category required'),
  display_name: z.string().min(1, 'Service name required').max(200),
  description: z.string().max(1000).optional(),
  price_strategy: z.enum(['flat', 'hourly', 'quote']),
  base_price_cents: z.number().int().min(0).optional(),
  hourly_rate_cents: z.number().int().min(0).optional(),
  min_charge_cents: z.number().int().min(0).optional(),
  estimated_duration_minutes: z.number().int().min(0).optional(),
})

const UPDATE_SERVICE_SCHEMA = CREATE_SERVICE_SCHEMA.partial().extend({
  is_active: z.boolean().optional(),
})

/**
 * POST /api/provider/services — Create a new service for the current provider.
 * Requires: authenticated user with a provider row.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = CREATE_SERVICE_SCHEMA.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const input = parsed.data

  // Look up the user's provider_id
  const { data: provider, error: providerError } = await supabase
    .from('service_providers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (providerError) {
    console.error('[POST /api/provider/services] provider lookup error:', providerError)
    return NextResponse.json({ error: 'provider_lookup_failed' }, { status: 500 })
  }

  if (!provider) {
    return NextResponse.json(
      { error: 'not_a_provider', message: 'You must complete provider onboarding first.' },
      { status: 403 }
    )
  }

  // Validate price_strategy and required price fields
  if (input.price_strategy === 'flat' && !input.base_price_cents) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Flat-rate services require base_price_cents' },
      { status: 400 }
    )
  }
  if (input.price_strategy === 'hourly' && !input.hourly_rate_cents) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Hourly services require hourly_rate_cents' },
      { status: 400 }
    )
  }

  const { data: service, error: insertError } = await supabase
    .from('provider_services')
    .insert({
      provider_id: provider.id,
      service_slug: input.service_slug,
      display_name: input.display_name,
      description: input.description ?? null,
      price_strategy: input.price_strategy,
      base_price_cents: input.base_price_cents ?? null,
      hourly_rate_cents: input.hourly_rate_cents ?? null,
      min_charge_cents: input.min_charge_cents ?? null,
      estimated_duration_minutes: input.estimated_duration_minutes ?? null,
      is_active: true,
    })
    .select('*')
    .single()

  if (insertError) {
    console.error('[POST /api/provider/services] insert error:', insertError)
    return NextResponse.json(
      { error: 'insert_failed', message: insertError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ service }, { status: 201 })
}

/**
 * GET /api/provider/services — List services for the current provider.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: provider } = await supabase
    .from('service_providers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!provider) {
    return NextResponse.json({ error: 'not_a_provider' }, { status: 403 })
  }

  const { data: services, error } = await supabase
    .from('provider_services')
    .select('*')
    .eq('provider_id', provider.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ services })
}
