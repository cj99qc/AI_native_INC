import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('auctions').select('*').order('end_time', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ auctions: data })
}

const createSchema = z.object({ deliveryJobId: z.string(), endTime: z.string(), minBid: z.number().default(0) })

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { data, error } = await supabase.from('auctions').insert({ delivery_job_id: parsed.data.deliveryJobId, end_time: parsed.data.endTime, min_bid: parsed.data.minBid, status: 'active' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ auction: data })
}