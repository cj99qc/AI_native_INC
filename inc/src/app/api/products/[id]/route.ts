import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { generateProductEmbedding } from '@/lib/embeddings'

const UPDATE_PRODUCT_SCHEMA = z.object({
  name:        z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  price:       z.number().positive().optional(),
  category_id: z.string().uuid().optional().nullable(),
  unit:        z.string().trim().max(20).optional(),
  currency:    z.string().trim().length(3).optional(),
  stock:       z.number().int().min(0).optional(),
  images:      z.array(z.string().url()).max(5).optional(),
  is_active:   z.boolean().optional(),
})

/**
 * GET /api/products/[id] — Fetch a single product.
 * Public endpoint (anyone can read active products).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase()
  const { id } = await params

  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ product })
}

/**
 * PATCH /api/products/[id] — Update a product (owner only).
 * RLS enforces that only the vendor who owns the product can update it.
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

  const parsed = UPDATE_PRODUCT_SCHEMA.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const input = parsed.data

  // Fetch current product to check ownership (RLS will enforce, but fetch anyway to give good error).
  const { data: existing, error: fetchError } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (existing.vendor_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // If name, description, or category changed, regenerate embedding.
  let embedding: number[] | null = existing.embedding ?? null
  const nameChanged = input.name !== undefined && input.name !== existing.name
  const descChanged = input.description !== undefined && input.description !== existing.description
  const categoryChanged = input.category_id !== undefined && input.category_id !== existing.category_id

  if (nameChanged || descChanged || categoryChanged) {
    try {
      const categoryText = input.category_id
        ? `category_${input.category_id}`
        : existing.category_id
          ? `category_${existing.category_id}`
          : ''
      embedding = await generateProductEmbedding({
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        category: categoryText,
      })
    } catch (err) {
      console.warn('[PATCH /api/products/[id]] embedding regeneration failed, keeping old:', err)
    }
  }

  const updateData: Record<string, unknown> = {}
  if (input.name !== undefined) updateData.name = input.name
  if (input.description !== undefined) updateData.description = input.description
  if (input.price !== undefined) updateData.price = input.price
  if (input.category_id !== undefined) updateData.category_id = input.category_id
  if (input.unit !== undefined) updateData.unit = input.unit
  if (input.currency !== undefined) updateData.currency = input.currency
  if (input.stock !== undefined) updateData.stock = input.stock
  if (input.images !== undefined) updateData.images = input.images
  if (input.is_active !== undefined) updateData.is_active = input.is_active
  if (embedding !== null) updateData.embedding = embedding
  updateData.updated_at = new Date().toISOString()

  const { data: product, error: updateError } = await supabase
    .from('products')
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    console.error('[PATCH /api/products/[id]] update error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ product })
}

/**
 * DELETE /api/products/[id] — Delete a product (owner only).
 * By default, soft-deletes (sets is_active=false).
 * With ?hard=true, hard-deletes the row (admin only).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const url = new URL(req.url)
  const hardDelete = url.searchParams.get('hard') === 'true'

  // Check ownership + admin status.
  const { data: product, error: fetchError } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const isOwner = product.vendor_id === user.id
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  const isAdmin = profile?.role === 'admin'

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (hardDelete && !isAdmin) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Only admins can hard-delete products' },
      { status: 403 }
    )
  }

  if (hardDelete) {
    // Admin hard-delete
    const { error: deleteError } = await supabase.from('products').delete().eq('id', id)
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }
    return NextResponse.json({ deleted: true })
  } else {
    // Soft-delete: set is_active = false
    const { error: updateError } = await supabase
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    return NextResponse.json({ deleted: true, soft: true })
  }
}
