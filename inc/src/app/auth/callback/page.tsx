'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { Loader2 } from 'lucide-react'

export default function AuthCallbackPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect')

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Auth callback error:', error)
          router.push('/(auth)/login?error=callback_error')
          return
        }

        if (session?.user) {
          // Get user profile to determine redirect
          const { data: profile } = await supabase
            .from('profiles')
            .select('role, onboarding_completed, kyc_status')
            .eq('id', session.user.id)
            .single()

          if (redirectTo) {
            router.push(redirectTo)
            return
          }

          // Role-based redirects as per requirements
          switch (profile?.role) {
            case 'customer':
              router.push('/dashboard/customer')
              break
            case 'vendor':
              if (!profile.onboarding_completed) {
                router.push('/vendor/onboarding')
              } else {
                router.push('/dashboard/vendor')
              }
              break
            case 'driver':
              if (profile.kyc_status === 'pending' || !profile.kyc_status) {
                router.push('/driver/kyc')
              } else {
                router.push('/dashboard/driver')
              }
              break
            case 'admin':
              router.push('/dashboard/admin')
              break
            default:
              router.push('/dashboard/customer')
          }
        } else {
          router.push('/(auth)/login')
        }
      } catch (error) {
        console.error('Unexpected auth callback error:', error)
        router.push('/(auth)/login?error=unexpected_error')
      }
    }

    handleAuthCallback()
  }, [supabase, router, redirectTo])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
        <p className="text-gray-600 dark:text-gray-400">
          Completing sign in...
        </p>
      </div>
    </div>
  )
}