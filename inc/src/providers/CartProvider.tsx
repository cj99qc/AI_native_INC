'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type CartItem = { productId: string; vendorId: string; name: string; price: number; quantity: number }

function loadCart(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('inc:cart')
    return raw ? (JSON.parse(raw) as CartItem[]) : []
  } catch {
    return []
  }
}

function saveCart(items: CartItem[]) {
  try {
    localStorage.setItem('inc:cart', JSON.stringify(items))
  } catch {}
}

export const CartContext = createContext<{
  items: CartItem[]
  add: (item: CartItem) => void
  remove: (productId: string) => void
  clear: () => void
}>({ items: [], add: () => {}, remove: () => {}, clear: () => {} })

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  useEffect(() => {
    setItems(loadCart())
  }, [])

  useEffect(() => {
    saveCart(items)
  }, [items])

  const value = useMemo(
    () => ({
      items,
      add: (item: CartItem) => {
        setItems(prev => {
          const idx = prev.findIndex(p => p.productId === item.productId)
          if (idx >= 0) {
            const updated = [...prev]
            updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + item.quantity }
            return updated
          }
          return [...prev, item]
        })
      },
      remove: (productId: string) => setItems(prev => prev.filter(p => p.productId !== productId)),
      clear: () => setItems([]),
    }),
    [items]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  return useContext(CartContext)
}