import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { generateProductEmbedding } from '@/lib/embeddings'

const CREATE_PRODUCT_SCHEMA = z.object({
  name:        z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  price:       z.number().positive(),
  category_id: z.string().uuid().optional().nullable(),
  unit:        z.string().trim().max(20).default('each'),
  currency:    z.string().trim().length(3).default('INR'),
  stock:       z.number().int().min(0).default(0),
  images:      z.array(z.string().url()).max(5).default([]),
})

/**
 * POST /api/products — Create a new product.
 * Requires: authenticated user with a vendor row (profiles.role = 'vendor').
 * RLS enforces that a vendor can only create products for their own vendor_id.
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

  const parsed = CREATE_PRODUCT_SCHEMA.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const input = parsed.data

  // Look up the user's vendor_id from the vendors table.
  // (Note: eventually products.vendor_id should reference vendors.id, not profiles.id,
  // but for now we use user.id as the vendor_id since that's what the schema expects.)
  const { data: vendor, error: vendorError } = await supabase
    .from('vendors')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (vendorError) {
    console.error('[POST /api/products] vendor lookup error:', vendorError)
    return NextResponse.json(
      { error: 'vendor_lookup_failed', message: vendorError.message },
      { status: 500 }
    )
  }

  if (!vendor) {
    // User has no vendor row; they must onboard as a vendor first.
    return NextResponse.json(
      { error: 'not_a_vendor', message: 'You must complete vendor onboarding first.' },
      { status: 403 }
    )
  }

  // Generate embedding from name + description + category.
  let embedding: number[] | null = null
  try {
    const categoryText = input.category_id ? `category_${input.category_id}` : ''
    embedding = await generateProductEmbedding({
      name: input.name,
      description: input.description,
      category: categoryText,
    })
  } catch (err) {
    console.warn('[POST /api/products] embedding generation failed, proceeding without:', err)
    // Non-fatal: product is still created, just without embedding for search.
  }

  // Create the product row.
  // RLS policy allows INSERT because auth.uid() = vendor_id will be satisfied
  // (we're setting vendor_id to user.id).
  const { data: product, error: insertError } = await supabase
    .from('products')
    .insert({
      vendor_id: user.id,
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      category_id: input.category_id ?? null,
      unit: input.unit,
      currency: input.currency,
      stock: input.stock,
      images: input.images,
      embedding: embedding ?? null,
      is_active: true,
    })
    .select('*')
    .single()

  if (insertError) {
    console.error('[POST /api/products] insert error:', insertError)
    return NextResponse.json(
      { error: 'insert_failed', message: insertError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ product }, { status: 201 })
}

/**
 * GET /api/products — List all active products (public endpoint).
 * Optional query params:
 *   - vendor_id: filter by vendor
 *   - category_id: filter by category
 *   - limit: max results (default 50, max 200)
 *   - offset: pagination offset (default 0)
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()

  const url = new URL(req.url)
  const vendor_id = url.searchParams.get('vendor_id')
  const category_id = url.searchParams.get('category_id')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0')

  let query = supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (vendor_id) query = query.eq('vendor_id', vendor_id)
  if (category_id) query = query.eq('category_id', category_id)

  const { data: products, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    products,
    count,
    limit,
    offset,
  })
}
