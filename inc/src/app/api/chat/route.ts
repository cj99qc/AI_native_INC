import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getOpenAI } from '@/lib/openai'
import { createServerSupabase } from '@/lib/supabase/server'

const schema = z.object({ query: z.string().min(1), contextId: z.string().optional(), contextType: z.string().optional() })

type MatchProduct = { id: string; name: string; description: string | null }

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  const openai = getOpenAI()
  const supabase = await createServerSupabase()
  const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: parsed.data.query })
  const vector = emb.data[0].embedding
  const { data: matches } = await supabase.rpc('match_products', { query_embedding: vector as unknown as number[], match_threshold: 0.2, match_count: 5 })

  const m = (matches ?? []) as unknown as MatchProduct[]
  const context = m.map((x) => `- ${x.name}: ${x.description ?? ''}`).join('\n')
  const content = `User question: ${parsed.data.query}\nRelevant context:\n${context}\nAnswer concisely.`
  const chat = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content }] })
  const answer = chat.choices[0]?.message?.content ?? 'Sorry, I do not know.'
  return NextResponse.json({ answer, references: m })
}