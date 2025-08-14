'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Mail, Lock, Loader2, Sparkles, Chrome, Apple } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect')
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [useMagicLink, setUseMagicLink] = useState(true)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSuccess() {
    // Get user profile to determine redirect
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, onboarding_completed, kyc_status')
        .eq('id', user.id)
        .single()

      if (redirectTo) {
        router.push(redirectTo)
        return
      }

      // Role-based redirects
      switch (profile?.role) {
        case 'vendor':
          if (!profile.onboarding_completed) {
            router.push('/vendor/onboarding')
          } else {
            router.push('/vendor/dashboard')
          }
          break
        case 'driver':
          if (profile.kyc_status === 'pending' || !profile.kyc_status) {
            router.push('/driver/kyc')
          } else {
            router.push('/driver/dashboard')
          }
          break
        case 'admin':
          router.push('/admin/dashboard')
          break
        default:
          router.push('/')
      }
    }
  }

  async function signInWithPassword() {
    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (authError) {
        setError(authError.message)
      } else {
        await handleSuccess()
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  async function sendMagic() {
    if (!email) {
      setError('Please enter your email address')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const { error } = await supabase.auth.signInWithOtp({ 
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback${redirectTo ? `?redirect=${redirectTo}` : ''}`
        }
      })
      if (!error) {
        setSent(true)
      } else {
        setError(error.message)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  async function signInWithProvider(provider: 'google' | 'apple') {
    setIsLoading(true)
    setError('')

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback${redirectTo ? `?redirect=${redirectTo}` : ''}`
        }
      })

      if (error) {
        setError(error.message)
        setIsLoading(false)
      }
      // Don't set loading to false here as we're redirecting
    } catch {
      setError('An unexpected error occurred')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="shadow-2xl border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-purple-600"
            >
              <Sparkles className="h-6 w-6 text-white" />
            </motion.div>
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Welcome back
            </CardTitle>
            <CardDescription>
              Sign in to your InC account
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {sent ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-4"
              >
                <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <Mail className="h-8 w-8 mx-auto mb-2 text-green-600 dark:text-green-400" />
                  <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                    Check your email for the login link
                  </p>
                  <p className="text-xs text-green-500 dark:text-green-500 mt-1">
                    We sent a secure login link to {email}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setSent(false)}
                  className="w-full"
                >
                  Send another link
                </Button>
              </motion.div>
            ) : (
              <>
                {/* Social Auth */}
                <div className="space-y-3">
                  <Button
                    onClick={() => signInWithProvider('google')}
                    disabled={isLoading}
                    variant="outline"
                    className="w-full h-11"
                  >
                    <Chrome className="h-4 w-4 mr-2" />
                    Continue with Google
                  </Button>
                  <Button
                    onClick={() => signInWithProvider('apple')}
                    disabled={isLoading}
                    variant="outline"
                    className="w-full h-11"
                  >
                    <Apple className="h-4 w-4 mr-2" />
                    Continue with Apple
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>

                {/* Auth Method Toggle */}
                <div className="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
                  <button
                    onClick={() => setUseMagicLink(true)}
                    className={`flex-1 text-sm py-2 px-3 rounded-md transition-all ${
                      useMagicLink
                        ? 'bg-white dark:bg-gray-600 shadow-sm font-medium text-gray-900 dark:text-white'
                        : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    Magic Link
                  </button>
                  <button
                    onClick={() => setUseMagicLink(false)}
                    className={`flex-1 text-sm py-2 px-3 rounded-md transition-all ${
                      !useMagicLink
                        ? 'bg-white dark:bg-gray-600 shadow-sm font-medium text-gray-900 dark:text-white'
                        : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    Password
                  </button>
                </div>

                {/* Form Fields */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  {!useMagicLink && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2"
                    >
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                        <Input
                          type="password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                    </motion.div>
                  )}
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                  >
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  </motion.div>
                )}

                <Button
                  onClick={useMagicLink ? sendMagic : signInWithPassword}
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {useMagicLink ? 'Sending...' : 'Signing in...'}
                    </>
                  ) : (
                    useMagicLink ? 'Send Magic Link' : 'Sign In'
                  )}
                </Button>

                <div className="text-center text-sm text-gray-600 dark:text-gray-400">
                  Don&apos;t have an account?{' '}
                  <Link href="/(auth)/signup" className="text-blue-600 hover:text-blue-700 font-medium">
                    Create one
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}