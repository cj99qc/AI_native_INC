'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { User, Store, Truck, Mail, Lock, Loader2, Chrome, Apple } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

type UserRole = 'customer' | 'vendor' | 'driver'

export default function SignupPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect')
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [selectedRole, setSelectedRole] = useState<UserRole>('customer')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const roleConfig = {
    customer: {
      icon: User,
      title: 'Customer',
      description: 'Discover and order from local businesses',
      color: 'bg-blue-500'
    },
    vendor: {
      icon: Store,
      title: 'Business Owner',
      description: 'List products and grow your business',
      color: 'bg-green-500'
    },
    driver: {
      icon: Truck,
      title: 'Driver',
      description: 'Earn by delivering orders in your area',
      color: 'bg-purple-500'
    }
  }

  async function handleSuccess(userId: string) {
    // Create profile with selected role
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        name,
        role: selectedRole,
        onboarding_completed: selectedRole === 'customer',
        kyc_status: selectedRole === 'driver' ? 'pending' : null
      })

    if (profileError) {
      console.error('Error creating profile:', profileError)
    }

    // Role-based redirects
    if (redirectTo) {
      router.push(redirectTo)
      return
    }

    switch (selectedRole) {
      case 'vendor':
        router.push('/vendor/onboarding')
        break
      case 'driver':
        router.push('/driver/kyc')
        break
      default:
        router.push('/')
    }
  }

  async function signup() {
    if (!email || !password || !name) {
      setError('Please fill in all fields')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            role: selectedRole
          },
          emailRedirectTo: `${window.location.origin}/auth/callback${redirectTo ? `?redirect=${redirectTo}` : ''}`
        }
      })

      if (authError) {
        setError(authError.message)
      } else if (data.user && !data.session) {
        setError('Please check your email to confirm your account before signing in.')
      } else if (data.user && data.session) {
        await handleSuccess(data.user.id)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  async function signUpWithProvider(provider: 'google' | 'apple') {
    setIsLoading(true)
    setError('')

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback${redirectTo ? `?redirect=${redirectTo}` : ''}`,
          queryParams: {
            signup_role: selectedRole
          }
        }
      })

      if (error) {
        setError(error.message)
        setIsLoading(false)
      }
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
              <Store className="h-6 w-6 text-white" />
            </motion.div>
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Join InC
            </CardTitle>
            <CardDescription>
              Choose your role and start your journey
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Role Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Select your role
              </label>
              <Tabs value={selectedRole} onValueChange={(value) => setSelectedRole(value as UserRole)}>
                <TabsList className="grid w-full grid-cols-3">
                  {Object.entries(roleConfig).map(([role, config]) => (
                    <TabsTrigger key={role} value={role} className="text-xs">
                      <config.icon className="h-3 w-3 mr-1" />
                      {config.title}
                    </TabsTrigger>
                  ))}
                </TabsList>
                
                {Object.entries(roleConfig).map(([role, config]) => (
                  <TabsContent key={role} value={role} className="mt-3">
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-full ${config.color}`}>
                          <config.icon className="h-4 w-4 text-white" />
                        </div>
                        <h3 className="font-medium text-gray-900 dark:text-white">
                          {config.title}
                        </h3>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {config.description}
                      </p>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>

            {/* Social Auth */}
            <div className="space-y-3">
              <Button
                onClick={() => signUpWithProvider('google')}
                disabled={isLoading}
                variant="outline"
                className="w-full h-11"
              >
                <Chrome className="h-4 w-4 mr-2" />
                Continue with Google
              </Button>
              <Button
                onClick={() => signUpWithProvider('apple')}
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
                  Or continue with email
                </span>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

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

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    type="password"
                    placeholder="Create a secure password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
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
              onClick={signup}
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </Button>

            <div className="text-center text-sm text-gray-600 dark:text-gray-400">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Sign in
              </Link>
            </div>

            {selectedRole !== 'customer' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
              >
                <div className="flex items-start gap-2">
                  <div className="h-2 w-2 rounded-full bg-yellow-500 mt-1.5 flex-shrink-0" />
                  <div className="text-xs text-yellow-700 dark:text-yellow-300">
                    <p className="font-medium mb-1">
                      {selectedRole === 'vendor' ? 'Business Verification Required' : 'Driver Verification Required'}
                    </p>
                    <p>
                      {selectedRole === 'vendor' 
                        ? 'You will need to complete business verification and setup before listing products.'
                        : 'You will need to complete identity verification and background checks before accepting deliveries.'
                      }
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}