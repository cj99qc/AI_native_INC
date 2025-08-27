'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { User, Store, Truck, Mail, Lock, Loader2, Chrome, Apple, Shield, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

type UserRole = 'customer' | 'vendor' | 'driver' | 'admin'

export default function SignupPage() {
  const supabase = useSupabase()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect')
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [selectedRole, setSelectedRole] = useState<UserRole>('customer')
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>(['customer']) // Support multiple roles
  const [allowMultipleRoles, setAllowMultipleRoles] = useState(false)
  const [isDevMode, setIsDevMode] = useState(false) // For skipping email confirmation
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
    },
    admin: {
      icon: Shield,
      title: 'Admin',
      description: 'Manage platform and users',
      color: 'bg-red-500'
    }
  }

  async function handleSuccess(userId: string) {
    // Create profile with selected role(s)
    const primaryRole = allowMultipleRoles ? selectedRoles[0] : selectedRole
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        name,
        role: primaryRole,
        onboarding_completed: primaryRole === 'customer',
        kyc_status: primaryRole === 'driver' ? 'pending' : null
      })

    if (profileError) {
      console.error('Error creating profile:', profileError)
    }

    // For multiple roles, we could extend the schema to support a roles array or 
    // create additional profile entries. For now, we'll use the primary role.
    // In a production system, you'd want to extend the database schema.

    // Role-based redirects
    if (redirectTo) {
      router.push(redirectTo)
      return
    }

    switch (primaryRole) {
      case 'vendor':
        router.push('/vendor/onboarding')
        break
      case 'driver':
        router.push('/driver/kyc')
        break
      case 'admin':
        router.push('/dashboard/admin')
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

    // Validate role selection
    if (allowMultipleRoles && selectedRoles.length === 0) {
      setError('Please select at least one role')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const primaryRole = allowMultipleRoles ? selectedRoles[0] : selectedRole
      
      // In development mode, we'll try to sign up without email confirmation requirement
      const signUpOptions = {
        email,
        password,
        options: {
          data: {
            name,
            role: primaryRole,
            roles: allowMultipleRoles ? selectedRoles : [primaryRole] // Store all selected roles
          },
          ...(isDevMode ? {} : {
            emailRedirectTo: `${window.location.origin}/auth/callback${redirectTo ? `?redirect=${redirectTo}` : ''}`
          })
        }
      }

      const { data, error: authError } = await supabase.auth.signUp(signUpOptions)

      if (authError) {
        setError(authError.message)
      } else if (data.user && !data.session && !isDevMode) {
        setError('Please check your email to confirm your account before signing in.')
      } else if (data.user && (data.session || isDevMode)) {
        await handleSuccess(data.user.id)
      } else if (data.user && !data.session && isDevMode) {
        // In dev mode, if no session but user exists, try to sign them in
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        })
        
        if (signInError) {
          setError('Account created but sign-in failed. Please try logging in manually.')
        } else if (signInData.session) {
          await handleSuccess(signInData.user.id)
        }
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
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Select your role(s)
                </label>
                <button
                  type="button"
                  onClick={() => setAllowMultipleRoles(!allowMultipleRoles)}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  {allowMultipleRoles ? (
                    <>
                      <CheckCircle className="h-3 w-3" />
                      Multiple roles
                    </>
                  ) : (
                    'Enable multiple roles'
                  )}
                </button>
              </div>

              {allowMultipleRoles ? (
                // Multiple role selection with checkboxes
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(roleConfig).map(([role, config]) => {
                    const isSelected = selectedRoles.includes(role as UserRole)
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedRoles(prev => prev.filter(r => r !== role))
                          } else {
                            setSelectedRoles(prev => [...prev, role as UserRole])
                          }
                        }}
                        className={`p-2 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`p-1 rounded-full ${config.color}`}>
                            <config.icon className="h-3 w-3 text-white" />
                          </div>
                          <span className="text-xs font-medium">{config.title}</span>
                          {isSelected && <CheckCircle className="h-3 w-3 text-blue-600 ml-auto" />}
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {config.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              ) : (
                // Single role selection with tabs
                <Tabs value={selectedRole} onValueChange={(value) => setSelectedRole(value as UserRole)}>
                  <TabsList className="grid w-full grid-cols-4">
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
              )}
            </div>

            {/* Development Mode Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <div>
                <label className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Development Mode
                </label>
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  Skip email confirmation for testing
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDevMode(!isDevMode)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isDevMode
                    ? 'bg-blue-600'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isDevMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
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

            {((allowMultipleRoles && selectedRoles.some(role => role !== 'customer')) || (!allowMultipleRoles && selectedRole !== 'customer')) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
              >
                <div className="flex items-start gap-2">
                  <div className="h-2 w-2 rounded-full bg-yellow-500 mt-1.5 flex-shrink-0" />
                  <div className="text-xs text-yellow-700 dark:text-yellow-300">
                    {(() => {
                      const currentRoles = allowMultipleRoles ? selectedRoles : [selectedRole]
                      const hasVendor = currentRoles.includes('vendor')
                      const hasDriver = currentRoles.includes('driver')
                      const hasAdmin = currentRoles.includes('admin')
                      
                      let title = 'Additional Requirements'
                      let message = ''
                      
                      if (hasAdmin && hasVendor && hasDriver) {
                        message = 'You will need to complete admin setup, business verification, and driver verification.'
                      } else if (hasAdmin && hasVendor) {
                        message = 'You will need to complete admin setup and business verification.'
                      } else if (hasAdmin && hasDriver) {
                        message = 'You will need to complete admin setup and driver verification.'
                      } else if (hasVendor && hasDriver) {
                        message = 'You will need to complete business and driver verification.'
                      } else if (hasAdmin) {
                        title = 'Admin Access'
                        message = 'You will have full platform administration privileges.'
                      } else if (hasVendor) {
                        title = 'Business Verification Required'
                        message = 'You will need to complete business verification and setup before listing products.'
                      } else if (hasDriver) {
                        title = 'Driver Verification Required'
                        message = 'You will need to complete identity verification and background checks before accepting deliveries.'
                      }
                      
                      return (
                        <>
                          <p className="font-medium mb-1">{title}</p>
                          <p>{message}</p>
                        </>
                      )
                    })()}
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