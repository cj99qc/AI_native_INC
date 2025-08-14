'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useRouter } from 'next/navigation'

export type UserRole = 'customer' | 'vendor' | 'driver' | 'admin'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  profile?: {
    name?: string
    phone?: string
    location?: Record<string, unknown>
    kyc_status?: string
    onboarding_completed?: boolean
  }
}

export function useAuth() {
  const supabase = useSupabase()
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function getProfile(userId: string) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()
        return profile
      } catch (error) {
        console.error('Error fetching profile:', error)
        return null
      }
    }

    async function updateUser() {
      try {
        const { data: authData } = await supabase.auth.getUser()
        
        if (authData.user && mounted) {
          const profile = await getProfile(authData.user.id)
          setUser({
            id: authData.user.id,
            email: authData.user.email || '',
            role: (profile?.role as UserRole) || 'customer',
            profile: profile || undefined
          })
        } else if (mounted) {
          setUser(null)
        }
      } catch (error) {
        console.error('Auth error:', error)
        if (mounted) setUser(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    updateUser()

    const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const profile = await getProfile(session.user.id)
        if (mounted) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            role: (profile?.role as UserRole) || 'customer',
            profile: profile || undefined
          })
        }
      } else if (event === 'SIGNED_OUT') {
        if (mounted) setUser(null)
      }
    })

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [supabase])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return { 
    user, 
    loading, 
    signOut,
    isAuthenticated: !!user,
    isCustomer: user?.role === 'customer',
    isVendor: user?.role === 'vendor',
    isDriver: user?.role === 'driver',
    isAdmin: user?.role === 'admin'
  }
}