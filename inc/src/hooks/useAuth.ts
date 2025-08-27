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
        console.log(`[useAuth] Fetching profile for user: ${userId}`)
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()
        
        if (error) {
          console.error('[useAuth] Profile fetch error:', error)
          return null
        }
        
        console.log(`[useAuth] Profile fetched:`, profile)
        return profile
      } catch (error) {
        console.error('[useAuth] Error fetching profile:', error)
        return null
      }
    }

    async function updateUser() {
      try {
        console.log('[useAuth] Checking current user...')
        const { data: authData, error } = await supabase.auth.getUser()
        
        if (error) {
          console.error('[useAuth] Auth error:', error)
          if (mounted) {
            setUser(null)
            setLoading(false)
          }
          return
        }
        
        if (authData.user && mounted) {
          console.log(`[useAuth] User found: ${authData.user.email}`)
          const profile = await getProfile(authData.user.id)
          const userData: AuthUser = {
            id: authData.user.id,
            email: authData.user.email || '',
            role: (profile?.role as UserRole) || 'customer',
            profile: profile || undefined
          }
          console.log(`[useAuth] Setting user data:`, userData)
          setUser(userData)
        } else if (mounted) {
          console.log('[useAuth] No user found')
          setUser(null)
        }
      } catch (error) {
        console.error('[useAuth] Auth error:', error)
        if (mounted) setUser(null)
      } finally {
        if (mounted) {
          console.log('[useAuth] Setting loading to false')
          setLoading(false)
        }
      }
    }

    updateUser()

    const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[useAuth] Auth state change: ${event}`, session?.user?.email || 'no user')
      
      if (event === 'SIGNED_IN' && session?.user) {
        const profile = await getProfile(session.user.id)
        if (mounted) {
          const userData: AuthUser = {
            id: session.user.id,
            email: session.user.email || '',
            role: (profile?.role as UserRole) || 'customer',
            profile: profile || undefined
          }
          console.log(`[useAuth] User signed in:`, userData)
          setUser(userData)
          setLoading(false)
        }
      } else if (event === 'SIGNED_OUT') {
        console.log('[useAuth] User signed out')
        if (mounted) {
          setUser(null)
          setLoading(false)
        }
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('[useAuth] Token refreshed')
        // Update user data in case profile changed
        if (session?.user && mounted) {
          const profile = await getProfile(session.user.id)
          const userData: AuthUser = {
            id: session.user.id,
            email: session.user.email || '',
            role: (profile?.role as UserRole) || 'customer',
            profile: profile || undefined
          }
          setUser(userData)
        }
      }
    })

    return () => {
      console.log('[useAuth] Cleaning up subscription')
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