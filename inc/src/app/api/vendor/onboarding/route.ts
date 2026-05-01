import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { geocodeAddress } from '@/lib/geocode'

const HOURS_DAY = z.object({
  closed: z.boolean().default(false),
  open:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  close:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
})

const HOURS_SCHEMA = z.object({
  mon: HOURS_DAY, tue: HOURS_DAY, wed: HOURS_DAY,
  thu: HOURS_DAY, fri: HOURS_DAY, sat: HOURS_DAY, sun: HOURS_DAY,
}).partial()

const ONBOARDING_SCHEMA = z.object({
  business_name:        z.string().trim().min(1).max(120),
  description:          z.string().trim().max(1000).optional().nullable(),
  category:             z.enum(['restaurant','grocery','retail','pharmacy','bakery','hardware','other']),
  phone:                z.string().trim().min(5).max(30),
  email:                z.string().email(),
  address:              z.string().trim().min(1),
  city:                 z.string().trim().min(1),
  state:                z.string().trim().optional().nullable(),
  zip_code:             z.string().trim().optional().nullable(),
  country:              z.string().trim().optional().nullable(),
  hours:                HOURS_SCHEMA.optional(),
  kyc_business_license: z.string().trim().optional().nullable(),
  kyc_tax_id:           z.string().trim().optional().nullable(),
  payout_method:        z.enum(['stripe_connect','manual_bank']).optional().nullable(),
})

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

  const parsed = ONBOARDING_SCHEMA.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const input = parsed.data

  // Reject duplicate signup early — one vendor row per user
  const { data: existing } = await supabase
    .from('vendors')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'already_onboarded', vendor_id: existing.id },
      { status: 409 }
    )
  }

  // Geocode the address — we need lat/lng for the GEOGRAPHY column.
  // The DB trigger compute_vendor_location() turns lat/lng into the PostGIS
  // point on insert. If geocoding fails we still allow signup, but the
  // vendor will not appear in proximity search until coordinates are set.
  const geo = await geocodeAddress({
    address:  input.address,
    city:     input.city,
    state:    input.state,
    zipCode:  input.zip_code,
    country:  input.country,
  })

  const { data: vendor, error: insertError } = await supabase
    .from('vendors')
    .insert({
      user_id:               user.id,
      business_name:         input.business_name,
      description:           input.description ?? null,
      category:              input.category,
      phone:                 input.phone,
      email:                 input.email,
      address:               input.address,
      city:                  input.city,
      state:                 input.state ?? null,
      zip_code:              input.zip_code ?? null,
      latitude:              geo?.lat ?? null,
      longitude:             geo?.lng ?? null,
      hours:                 input.hours ?? {},
      kyc_business_license:  input.kyc_business_license ?? null,
      kyc_tax_id:            input.kyc_tax_id ?? null,
      payout_method:         input.payout_method ?? null,
      onboarding_status:     'pending',
      is_active:             true,
    })
    .select('*')
    .single()

  if (insertError) {
    console.error('[vendor/onboarding] insert failed:', insertError)
    return NextResponse.json(
      { error: 'insert_failed', message: insertError.message },
      { status: 500 }
    )
  }

  // Promote the user to vendor role on their profile.
  // Failure here is non-fatal: the vendor row exists; an admin can fix later.
  const { error: roleError } = await supabase
    .from('profiles')
    .update({ role: 'vendor' })
    .eq('id', user.id)
  if (roleError) {
    console.warn('[vendor/onboarding] role update failed:', roleError.message)
  }

  return NextResponse.json({
    vendor,
    geocoded: !!geo,
    geocode_display: geo?.display_name ?? null,
  })
}

export async function GET() {
  // Returns the calling user's vendor row (or null).
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: vendor, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ vendor })
}
