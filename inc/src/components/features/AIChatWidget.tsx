'use client'

import { useState } from 'react'

export default function AIChatWidget({ contextId, contextType }: { contextId?: string; contextType?: string }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  async function send() {
    if (!input) return
    const userMsg = { role: 'user' as const, content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg.content, contextId, contextType }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer ?? 'No answer' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error fetching answer' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded border p-3">
      <div className="mb-2 text-sm font-medium">AI Assistant</div>
      <div className="mb-2 max-h-48 space-y-2 overflow-auto text-sm">
        {messages.map((m, idx) => (
          <div key={idx} className={m.role === 'user' ? 'text-right' : ''}>
            <span className="inline-block rounded bg-muted px-2 py-1">{m.content}</span>
          </div>
        ))}
        {loading && <div className="text-xs text-muted-foreground">Thinking…</div>}
      </div>
      <div className="flex gap-2">
        <input className="flex-1 rounded border px-2 py-1" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask anything" />
        <button className="rounded bg-primary px-3 py-1 text-primary-foreground" onClick={send}>Send</button>
      </div>
    </div>
  )
}