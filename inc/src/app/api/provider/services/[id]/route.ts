import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const UPDATE_SERVICE_SCHEMA = z.object({
  service_slug: z.string().min(1).optional(),
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  price_strategy: z.enum(['flat', 'hourly', 'quote']).optional(),
  base_price_cents: z.number().int().min(0).nullable().optional(),
  hourly_rate_cents: z.number().int().min(0).nullable().optional(),
  min_charge_cents: z.number().int().min(0).nullable().optional(),
  estimated_duration_minutes: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().optional(),
})

/**
 * GET /api/provider/services/[id] — Fetch a single service (public).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase()
  const { id } = await params

  const { data: service, error } = await supabase
    .from('provider_services')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!service) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ service })
}

/**
 * PATCH /api/provider/services/[id] — Update a service (owner only).
 * RLS enforces that only the provider who owns the service can update it.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = UPDATE_SERVICE_SCHEMA.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const input = parsed.data

  // Fetch current service to check ownership
  const { data: existing, error: fetchError } = await supabase
    .from('provider_services')
    .select(`
      *,
      provider:provider_id(
        user_id
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Check ownership
  const provider = (existing.provider as any)
  if (provider?.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // If service_slug is changing, verify it points to a real category.
  if (input.service_slug && input.service_slug !== existing.service_slug) {
    const { data: cat } = await supabase
      .from('service_categories')
      .select('slug')
      .eq('slug', input.service_slug)
      .maybeSingle()
    if (!cat) {
      return NextResponse.json(
        { error: 'invalid_request', message: `Unknown service category: ${input.service_slug}` },
        { status: 400 }
      )
    }
  }

  // Effective values after the patch is applied — use to validate the merged state.
  const effectiveStrategy = input.price_strategy ?? existing.price_strategy
  const effectiveBase   = input.base_price_cents  !== undefined ? input.base_price_cents  : existing.base_price_cents
  const effectiveHourly = input.hourly_rate_cents !== undefined ? input.hourly_rate_cents : existing.hourly_rate_cents

  if (effectiveStrategy === 'flat' && (effectiveBase == null || effectiveBase <= 0)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Flat-rate services require a positive base_price_cents' },
      { status: 400 }
    )
  }
  if (effectiveStrategy === 'hourly' && (effectiveHourly == null || effectiveHourly <= 0)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Hourly services require a positive hourly_rate_cents' },
      { status: 400 }
    )
  }

  // Build the patch — only include fields the client explicitly sent.
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.service_slug   !== undefined) updateData.service_slug   = input.service_slug
  if (input.display_name   !== undefined) updateData.display_name   = input.display_name
  if (input.description    !== undefined) updateData.description    = input.description
  if (input.price_strategy !== undefined) updateData.price_strategy = input.price_strategy
  if (input.base_price_cents          !== undefined) updateData.base_price_cents          = input.base_price_cents
  if (input.hourly_rate_cents         !== undefined) updateData.hourly_rate_cents         = input.hourly_rate_cents
  if (input.min_charge_cents          !== undefined) updateData.min_charge_cents          = input.min_charge_cents
  if (input.estimated_duration_minutes !== undefined) updateData.estimated_duration_minutes = input.estimated_duration_minutes
  if (input.is_active      !== undefined) updateData.is_active      = input.is_active

  const { data: service, error: updateError } = await supabase
    .from('provider_services')
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    console.error('[PATCH /api/provider/services/[id]] update error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ service })
}

/**
 * DELETE /api/provider/services/[id] — Delete a service (owner only, soft-delete).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  // Fetch service to check ownership
  const { data: service, error: fetchError } = await supabase
    .from('provider_services')
    .select(`
      *,
      provider:provider_id(
        user_id
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!service) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Check ownership
  const provider = (service.provider as any)
  if (provider?.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Soft-delete: set is_active = false
  const { error: deleteError } = await supabase
    .from('provider_services')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true, soft: true })
}
