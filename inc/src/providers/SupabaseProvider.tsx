'use client'

import { createContext, useContext, useMemo } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'

const SupabaseContext = createContext<ReturnType<typeof createBrowserSupabase> | null>(null)

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createBrowserSupabase(), [])
  return <SupabaseContext.Provider value={supabase}>{children}</SupabaseContext.Provider>
}

export function useSupabase() {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('SupabaseProvider is missing')
  return ctx
}