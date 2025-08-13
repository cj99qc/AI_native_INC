import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ results: [] })

  const { data: events } = await supabase.from('analytics_events').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200)
  const openai = getOpenAI()
  const prompt = `Given these user events (JSON), suggest up to 10 product categories and styles likely to convert. Return JSON array of strings. Events: ${JSON.stringify(events ?? [])}`
  const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] })
  const ideas = completion.choices[0]?.message?.content ?? '[]'
  return NextResponse.json({ ideas })
}