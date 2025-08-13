'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'

export function useAuth() {
  const supabase = useSupabase()
  const [user, setUser] = useState<null | { id: string }>(null)

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user ? { id: data.user.id } : null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      supabase.auth.getUser().then(({ data }) => setUser(data.user ? { id: data.user.id } : null))
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [supabase])

  return { user }
}