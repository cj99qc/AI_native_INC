'use client'

import { useEffect } from 'react'

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // could hydrate a toast system here
  }, [])
  return <>{children}</>
}