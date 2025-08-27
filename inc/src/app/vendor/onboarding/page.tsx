'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Store, 
  ChevronRight,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import Link from 'next/link'

type BusinessFormData = {
  name: string
  description: string
  business_type: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  zip_code: string
  website?: string
  hours_operation?: string
}

export default function VendorOnboarding() {
  const { user, isVendor, isAdmin } = useAuth()
  const supabase = useSupabase()

  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState<BusinessFormData>({
    name: '',
    description: '',
    business_type: 'retail',
    phone: '',
    email: user?.email || '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    website: '',
    hours_operation: '9:00 AM - 5:00 PM'
  })

  // Role protection
  if (!user) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-yellow-600 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Login Required</h2>
            <p className="text-gray-600 mb-4">Please log in to access vendor onboarding.</p>
            <Link href="/login">
              <Button>Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isVendor && !isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-red-600 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-gray-600 mb-4">Only vendors can access this onboarding process.</p>
            <Link href="/">
              <Button>Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleInputChange = (field: keyof BusinessFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError('')
  }

  const validateStep = (step: number) => {
    switch (step) {
      case 1:
        return formData.name && formData.description && formData.business_type
      case 2:
        return formData.phone && formData.email && formData.address && formData.city && formData.state && formData.zip_code
      default:
        return true
    }
  }

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, 3))
    } else {
      setError('Please fill in all required fields')
    }
  }

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1))
  }

  const handleSubmit = async () => {
    if (!user || !validateStep(2)) {
      setError('Please complete all required information')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      // Create or update business profile
      const businessData = {
        name: formData.name,
        description: formData.description,
        business_type: formData.business_type,
        owner_id: user.id,
        phone: formData.phone,
        email: formData.email,
        location: {
          address: formData.address,
          city: formData.city,
          state: formData.state,
          zip_code: formData.zip_code
        },
        website: formData.website || null,
        hours_operation: formData.hours_operation,
        status: 'active'
      }

      const { error: businessError } = await supabase
        .from('businesses')
        .upsert(businessData, {
          onConflict: 'owner_id',
          ignoreDuplicates: false
        })

      if (businessError) {
        throw businessError
      }

      // Update profile onboarding status
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ onboarding_completed: true })
        .eq('id', user.id)

      if (profileError) {
        throw profileError
      }

      // Success - move to step 3
      setCurrentStep(3)
    } catch (err) {
      console.error('Onboarding error:', err)
      setError('Failed to complete onboarding. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const businessTypes = [
    { value: 'retail', label: 'Retail Store' },
    { value: 'restaurant', label: 'Restaurant' },
    { value: 'grocery', label: 'Grocery Store' },
    { value: 'pharmacy', label: 'Pharmacy' },
    { value: 'electronics', label: 'Electronics' },
    { value: 'clothing', label: 'Clothing & Fashion' },
    { value: 'home_garden', label: 'Home & Garden' },
    { value: 'automotive', label: 'Automotive' },
    { value: 'health_beauty', label: 'Health & Beauty' },
    { value: 'services', label: 'Professional Services' },
    { value: 'other', label: 'Other' }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="mx-auto max-w-4xl p-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <Store className="h-16 w-16 mx-auto text-blue-600 mb-4" />
          <h1 className="text-3xl font-bold mb-2">Welcome to InC Business</h1>
          <p className="text-gray-600">Let&apos;s set up your business profile to start selling</p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center space-x-4">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  step < currentStep ? 'bg-green-600 text-white' :
                  step === currentStep ? 'bg-blue-600 text-white' :
                  'bg-gray-300 text-gray-600'
                }`}>
                  {step < currentStep ? <CheckCircle className="h-4 w-4" /> : step}
                </div>
                {step < 3 && (
                  <div className={`w-12 h-0.5 mx-2 ${
                    step < currentStep ? 'bg-green-600' : 'bg-gray-300'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>
              {currentStep === 1 && 'Business Information'}
              {currentStep === 2 && 'Contact & Location'}
              {currentStep === 3 && 'Setup Complete!'}
            </CardTitle>
            <CardDescription>
              {currentStep === 1 && 'Tell us about your business'}
              {currentStep === 2 && 'Where can customers find you?'}
              {currentStep === 3 && 'Your business is ready to go live'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                <div className="flex items-center">
                  <AlertCircle className="h-4 w-4 text-red-600 mr-2" />
                  <p className="text-red-700">{error}</p>
                </div>
              </div>
            )}

            {/* Step 1: Business Information */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Business Name *</label>
                  <Input
                    placeholder="Your Business Name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Business Description *</label>
                  <textarea
                    className="w-full p-3 border rounded-md h-24 resize-none"
                    placeholder="Describe your business, products, and services..."
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Business Type *</label>
                  <select
                    className="w-full p-3 border rounded-md"
                    value={formData.business_type}
                    onChange={(e) => handleInputChange('business_type', e.target.value)}
                  >
                    {businessTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Website (optional)</label>
                  <Input
                    type="url"
                    placeholder="https://your-website.com"
                    value={formData.website}
                    onChange={(e) => handleInputChange('website', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Business Hours</label>
                  <Input
                    placeholder="9:00 AM - 5:00 PM"
                    value={formData.hours_operation}
                    onChange={(e) => handleInputChange('hours_operation', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Step 2: Contact & Location */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Phone Number *</label>
                    <Input
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={formData.phone}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Email Address *</label>
                    <Input
                      type="email"
                      placeholder="business@example.com"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Street Address *</label>
                  <Input
                    placeholder="123 Main Street"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">City *</label>
                    <Input
                      placeholder="City"
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">State *</label>
                    <Input
                      placeholder="State"
                      value={formData.state}
                      onChange={(e) => handleInputChange('state', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">ZIP Code *</label>
                    <Input
                      placeholder="12345"
                      value={formData.zip_code}
                      onChange={(e) => handleInputChange('zip_code', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Complete */}
            {currentStep === 3 && (
              <div className="text-center space-y-6">
                <CheckCircle className="h-20 w-20 mx-auto text-green-600" />
                <div>
                  <h2 className="text-2xl font-bold text-green-800 mb-2">Business Setup Complete!</h2>
                  <p className="text-gray-600">
                    Your business profile has been created successfully. You can now start adding products and managing your store.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link href="/dashboard/vendor">
                    <Button size="lg">
                      Go to Dashboard
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/vendor/products">
                    <Button variant="outline" size="lg">
                      Add Products
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            {currentStep < 3 && (
              <div className="flex justify-between pt-6">
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  disabled={currentStep === 1}
                >
                  Previous
                </Button>
                <Button
                  onClick={currentStep === 2 ? handleSubmit : handleNext}
                  disabled={isLoading || !validateStep(currentStep)}
                >
                  {isLoading ? 'Saving...' : currentStep === 2 ? 'Complete Setup' : 'Next'}
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}