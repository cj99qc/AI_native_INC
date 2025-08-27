'use client'

import { createContext, useContext, useMemo, useEffect } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'

const SupabaseContext = createContext<ReturnType<typeof createBrowserSupabase> | null>(null)

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => {
    console.log('[SupabaseProvider] Creating Supabase client')
    
    // Check if environment variables are available
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!url || !anonKey) {
      console.error('[SupabaseProvider] Missing environment variables:', {
        url: !!url,
        anonKey: !!anonKey
      })
    }
    
    return createBrowserSupabase()
  }, [])

  useEffect(() => {
    // Test the connection
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[SupabaseProvider] Initial session check error:', error)
      } else {
        console.log('[SupabaseProvider] Initial session check:', data.session ? 'Session exists' : 'No session')
      }
    }).catch((error) => {
      console.error('[SupabaseProvider] Failed to check initial session:', error)
    })
  }, [supabase])

  return <SupabaseContext.Provider value={supabase}>{children}</SupabaseContext.Provider>
}

export function useSupabase() {
  const ctx = useContext(SupabaseContext)
  if (!ctx) throw new Error('SupabaseProvider is missing')
  return ctx
}