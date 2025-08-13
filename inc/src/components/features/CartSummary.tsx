'use client'

import { useMemo } from 'react'
import { useCart } from '@/providers/CartProvider'

export default function CartSummary() {
  const { items } = useCart()
  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>()
    for (const i of items) {
      const arr = map.get(i.vendorId) ?? []
      arr.push(i)
      map.set(i.vendorId, arr)
    }
    return Array.from(map.entries())
  }, [items])

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0)

  if (!items.length) return <div>Your cart is empty.</div>

  return (
    <div className="space-y-6">
      {grouped.map(([vendorId, arr]) => (
        <div key={vendorId} className="rounded border p-4">
          <div className="mb-2 text-sm text-muted-foreground">Vendor: {vendorId}</div>
          <ul className="space-y-1">
            {arr.map(i => (
              <li key={i.productId} className="flex justify-between text-sm">
                <span>{i.name} × {i.quantity}</span>
                <span>${'{'}(i.price * i.quantity).toFixed(2){'}'}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex justify-between border-t pt-4 font-medium" title={`Total ${total.toFixed(2)}`}>
        <span>Total</span>
        <span>${'{'}total.toFixed(2){'}'}</span>
      </div>
    </div>
  )
}