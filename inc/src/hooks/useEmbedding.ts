'use client'

import { useState } from 'react'

export function useEmbedding() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function embed(text: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/search/semantic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: text }) })
      const data = await res.json()
      return data
    } catch {
      setError('Failed to embed')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { embed, loading, error }
}