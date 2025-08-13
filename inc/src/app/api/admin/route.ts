import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: events } = await supabase.from('analytics_events').select('event_type,created_at').order('created_at', { ascending: false }).limit(1000)
  const summaryPrompt = `Summarize these recent events and surface anomalies. Return a short bullet list. ${JSON.stringify(events ?? [])}`
  const openai = getOpenAI()
  const chat = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: summaryPrompt }] })
  const summary = chat.choices[0]?.message?.content ?? ''
  return NextResponse.json({ summary, count: events?.length ?? 0 })
}