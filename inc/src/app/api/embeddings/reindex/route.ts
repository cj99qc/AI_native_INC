import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.REINDEX_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = await createServerSupabase()
  const openai = getOpenAI()

  const { data: products, error } = await supabase.from('products').select('id,name,description').limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  for (const p of products ?? []) {
    const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: `${p.name}. ${p.description ?? ''}` })
    const vector = emb.data[0].embedding
    await supabase.from('products').update({ embedding: vector as unknown as number[] }).eq('id', p.id)
  }
  return NextResponse.json({ ok: true, updated: products?.length ?? 0 })
}