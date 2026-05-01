import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001'

// A result must exceed this score to be shown as an anticipatory solution.
// Mirrors the RAG config similarity_threshold (0.7) with a slightly lower bar
// so the feature still fires on a warm-but-not-perfect index.
const CONFIDENCE_THRESHOLD = 0.65

const CATEGORY_LABELS: Record<string, string> = {
  missing_item:    'Missing Item',
  wrong_item:      'Wrong Item',
  damaged_item:    'Damaged Item',
  delivery_delay:  'Delivery Delay',
  driver_behavior: 'Driver Issue',
  payment_issue:   'Payment Issue',
  other:           'General Issue',
}

// ─── POST /api/support/rag-suggest ───────────────────────────────────────────
// After a ticket is created, call this to check the RAG index for similar
// resolved cases. Returns the best match if confidence >= CONFIDENCE_THRESHOLD.
//
// Body: { category: string, description: string }

export async function POST(req: Request) {
  const supabase = await createServerSupabase()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { category, description } = body
  if (typeof category !== 'string' || typeof description !== 'string') {
    return NextResponse.json({ error: 'category and description required' }, { status: 400 })
  }

  // Build a focused search query for the RAG index
  const catLabel = CATEGORY_LABELS[category] ?? 'Issue'
  const query    = `${catLabel}: ${description.trim()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(`${BRIDGE_URL}/api/rag/query`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        q:        query,
        top_k:    3,
        use_bm25: true,
        rerank:   false,
        filters:  { content_type: 'resolved_ticket' },
      }),
      signal:  controller.signal,
      cache:   'no-store',
    })
    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json({ suggestion: null })
    }

    const data = await res.json() as {
      results: Array<{
        id:           string
        score:        number
        source:       string
        text_snippet: string
        metadata:     Record<string, unknown>
      }>
    }

    // Pick the highest-scoring result above threshold
    const best = (data.results ?? [])
      .filter(r => r.score >= CONFIDENCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0]

    if (!best) {
      return NextResponse.json({ suggestion: null })
    }

    // Prefer a resolution_note in metadata; fall back to the text snippet
    const solution = (
      typeof best.metadata?.resolution_note === 'string' ? best.metadata.resolution_note :
      typeof best.metadata?.resolution      === 'string' ? best.metadata.resolution :
      best.text_snippet
    ).trim()

    return NextResponse.json({
      suggestion: {
        solution,
        score:   best.score,
        source:  best.source,
        result_id: best.id,
      },
    })
  } catch {
    clearTimeout(timer)
    return NextResponse.json({ suggestion: null })
  }
}
