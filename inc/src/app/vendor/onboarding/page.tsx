'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Store, MapPin, Phone, Mail, Building2, Loader2, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

type BusinessType = 'restaurant' | 'grocery' | 'retail' | 'pharmacy' | 'other'

const businessTypes = [
  { value: 'restaurant', label: 'Restaurant/Food Service', icon: '🍽️' },
  { value: 'grocery', label: 'Grocery Store', icon: '🛒' },
  { value: 'retail', label: 'Retail Store', icon: '🏪' },
  { value: 'pharmacy', label: 'Pharmacy', icon: '💊' },
  { value: 'other', label: 'Other', icon: '🏢' }
]

export default function VendorOnboardingPage() {
  const { user, isVendor, isAdmin, loading: authLoading } = useAuth()
  const supabase = useSupabase()
  const router = useRouter()
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    businessType: 'other' as BusinessType,
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zipCode: ''
  })

  useEffect(() => {
    // Check if user already has a business profile
    const checkExistingBusiness = async () => {
      if (!user) return
      
      try {
        const { data: business } = await supabase
          .from('businesses')
          .select('*')
          .eq('owner_id', user.id)
          .single()
        
        if (business) {
          // User already has a business, redirect to dashboard
          router.push('/dashboard/vendor')
          return
        }
      } catch (error) {
        console.log('No existing business found, proceeding with onboarding')
      }
    }
    
    if (user && !authLoading) {
      checkExistingBusiness()
    }
  }, [user, authLoading, supabase, router])

  // Role protection
  if (!authLoading && user && !isVendor && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <Store className="h-6 w-6 text-red-600" />
            </div>
            <CardTitle className="text-red-800">Access Denied</CardTitle>
            <CardDescription className="text-red-600">
              This page is only accessible to vendors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button className="w-full">Return Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!user) {
      setError('You must be logged in to complete onboarding')
      return
    }

    // Validate required fields
    if (!formData.name.trim() || !formData.businessType || !formData.phone.trim() || !formData.email.trim()) {
      setError('Please fill in all required fields')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Create business profile
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .insert({
          owner_id: user.id,
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          business_type: formData.businessType,
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          location: {
            address: formData.address.trim() || null,
            city: formData.city.trim() || null,
            state: formData.state.trim() || null,
            zip_code: formData.zipCode.trim() || null
          }
        })
        .select()
        .single()

      if (businessError) {
        console.error('Business creation error:', businessError)
        setError('Failed to create business profile. Please try again.')
        return
      }

      // Update profile onboarding status
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ onboarding_completed: true })
        .eq('id', user.id)

      if (profileError) {
        console.error('Profile update error:', profileError)
        // Don't fail here, business was created successfully
      }

      // Log analytics event
      await supabase
        .from('analytics_events')
        .insert({
          user_id: user.id,
          event_type: 'vendor_onboarding_completed',
          data: {
            business_id: business.id,
            business_type: formData.businessType,
            business_name: formData.name
          }
        })

      setSuccess(true)
      
      // Redirect to vendor dashboard after a short delay
      setTimeout(() => {
        router.push('/dashboard/vendor')
      }, 2000)

    } catch (error) {
      console.error('Onboarding error:', error)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-green-800">Welcome to AI Native!</CardTitle>
              <CardDescription>
                Your business profile has been created successfully. 
                Redirecting to your vendor dashboard...
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-2xl pt-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Store className="h-8 w-8 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">Complete Your Business Setup</CardTitle>
              <CardDescription>
                Tell us about your business so we can help customers find you
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Business Name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Business Name *
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Enter your business name"
                    className="w-full"
                    required
                  />
                </div>

                {/* Business Description */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Business Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    placeholder="Tell customers about your business (optional)"
                    className="w-full min-h-[80px] px-3 py-2 border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none rounded-md"
                  />
                </div>

                {/* Business Type */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Business Type *</label>
                  <div className="grid grid-cols-1 gap-2">
                    {businessTypes.map((type) => (
                      <label
                        key={type.value}
                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all hover:bg-gray-50 ${
                          formData.businessType === type.value 
                            ? 'border-blue-500 bg-blue-50' 
                            : 'border-gray-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="businessType"
                          value={type.value}
                          checked={formData.businessType === type.value}
                          onChange={(e) => handleInputChange('businessType', e.target.value)}
                          className="sr-only"
                        />
                        <span className="text-2xl">{type.icon}</span>
                        <span className="font-medium">{type.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Contact Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Contact Information</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        Phone Number *
                      </label>
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        placeholder="(555) 123-4567"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Business Email *
                      </label>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        placeholder="business@example.com"
                        required
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Business Address */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Business Address
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Street Address</label>
                      <Input
                        value={formData.address}
                        onChange={(e) => handleInputChange('address', e.target.value)}
                        placeholder="123 Main Street"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">City</label>
                        <Input
                          value={formData.city}
                          onChange={(e) => handleInputChange('city', e.target.value)}
                          placeholder="City"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">State</label>
                        <Input
                          value={formData.state}
                          onChange={(e) => handleInputChange('state', e.target.value)}
                          placeholder="State"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">ZIP Code</label>
                        <Input
                          value={formData.zipCode}
                          onChange={(e) => handleInputChange('zipCode', e.target.value)}
                          placeholder="12345"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3 rounded-lg bg-red-50 border border-red-200"
                  >
                    <p className="text-sm text-red-700">{error}</p>
                  </motion.div>
                )}

                <div className="flex gap-4">
                  <Link href="/dashboard/vendor" className="flex-1">
                    <Button type="button" variant="outline" className="w-full">
                      Skip for Now
                    </Button>
                  </Link>
                  <Button type="submit" disabled={loading} className="flex-1">
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating Profile...
                      </>
                    ) : (
                      'Complete Setup'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}