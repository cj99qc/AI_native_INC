'use client'

import { useState } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { User, Store, Truck, Mail, Lock, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

type UserRole = 'customer' | 'vendor' | 'driver'

export default function SignupPage() {
  const supabase = useSupabase()
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

  async function signup() {
    if (!email || !password || !name) {
      setError('Please fill in all fields')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            role: selectedRole
          }
        }
      })

      if (authError) {
        setError(authError.message)
      } else {
        // Show success message or redirect
        alert('Check your email to confirm your account.')
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
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
                  <TabsContent key={role} value={role} className="mt-2">
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center p-3 rounded-lg bg-gray-50 dark:bg-gray-700"
                    >
                      <config.icon className={`h-8 w-8 mx-auto mb-2 p-1.5 rounded-full text-white ${config.color}`} />
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {config.description}
                      </p>
                    </motion.div>
                  </TabsContent>
                ))}
              </Tabs>
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
                    placeholder="John Doe"
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
                    placeholder="Create a strong password"
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
              <Link href="/(auth)/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Sign in
              </Link>
            </div>

            {selectedRole !== 'customer' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
              >
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  <strong>Note:</strong> {selectedRole === 'vendor' ? 'Business' : 'Driver'} accounts require additional verification after signup.
                </p>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}