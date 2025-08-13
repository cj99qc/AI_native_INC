'use client'

import { useState } from 'react'
import { useCart } from '@/providers/CartProvider'

export default function CheckoutPage() {
  const { items, clear } = useCart()
  const [loading, setLoading] = useState(false)

  async function createSession() {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <button disabled={!items.length || loading} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" onClick={createSession}>
        {loading ? 'Redirecting…' : 'Pay with Stripe'}
      </button>
      <button className="ml-2 rounded border px-3 py-2" onClick={clear}>Clear Cart</button>
    </div>
  )
}