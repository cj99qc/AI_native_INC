'use client'

import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[createBrowserSupabase] Missing environment variables:', {
      url: !!supabaseUrl,
      anonKey: !!supabaseAnonKey
    })
    throw new Error('Missing Supabase environment variables. Please check your .env.local file.')
  }

  const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
  return supabase
}