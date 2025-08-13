import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getOpenAI } from '@/lib/openai'
import { createServerSupabase } from '@/lib/supabase/server'
import { getRatelimit } from '@/lib/rate-limit'

const schema = z.object({ q: z.string().min(1) })

export async function POST(req: NextRequest) {
  const ratelimit = getRatelimit()
  const id = req.headers.get('x-forwarded-for') ?? 'anonymous'
  const rl = await ratelimit.limit(`search:${id}`)
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  const openai = getOpenAI()
  const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: parsed.data.q })
  const vector = emb.data[0].embedding

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('match_products', {
    query_embedding: vector as unknown as number[],
    match_threshold: 0.2,
    match_count: 20,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ results: data })
}