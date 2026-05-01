'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Store, MapPin, Phone, Mail, Building2, Loader2, CheckCircle, Clock, ShieldCheck, Wallet } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

type BusinessCategory = 'restaurant' | 'grocery' | 'retail' | 'pharmacy' | 'bakery' | 'hardware' | 'other'
type PayoutMethod = 'stripe_connect' | 'manual_bank'
type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

const businessCategories: { value: BusinessCategory; label: string; icon: string }[] = [
  { value: 'restaurant', label: 'Restaurant / Food Service', icon: '🍽️' },
  { value: 'grocery',    label: 'Grocery Store',             icon: '🛒' },
  { value: 'bakery',     label: 'Bakery / Confectionery',    icon: '🧁' },
  { value: 'retail',     label: 'Retail Store',              icon: '🏪' },
  { value: 'pharmacy',   label: 'Pharmacy',                  icon: '💊' },
  { value: 'hardware',   label: 'Hardware / Tools',          icon: '🔧' },
  { value: 'other',      label: 'Other',                     icon: '🏢' },
]

const days: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

type DayHours = { closed: boolean; open: string; close: string }
type Hours = Record<DayKey, DayHours>

const defaultHours: Hours = {
  mon: { closed: false, open: '09:00', close: '18:00' },
  tue: { closed: false, open: '09:00', close: '18:00' },
  wed: { closed: false, open: '09:00', close: '18:00' },
  thu: { closed: false, open: '09:00', close: '18:00' },
  fri: { closed: false, open: '09:00', close: '18:00' },
  sat: { closed: false, open: '10:00', close: '16:00' },
  sun: { closed: true,  open: '10:00', close: '16:00' },
}

export default function VendorOnboardingPage() {
  const { user, isVendor, isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [checkingExisting, setCheckingExisting] = useState(true)

  const [formData, setFormData] = useState({
    business_name: '',
    description: '',
    category: 'other' as BusinessCategory,
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    kyc_business_license: '',
    kyc_tax_id: '',
    payout_method: 'stripe_connect' as PayoutMethod,
  })

  const [hours, setHours] = useState<Hours>(defaultHours)

  // If the user already has a vendor row, send them to the dashboard.
  useEffect(() => {
    if (!user || authLoading) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/vendor/onboarding')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled && json.vendor) {
          router.push('/dashboard/vendor')
        }
      } finally {
        if (!cancelled) setCheckingExisting(false)
      }
    })()
    return () => { cancelled = true }
  }, [user, authLoading, router])

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

  if (authLoading || checkingExisting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  const setField = (field: string, value: string) => {
    setFormData((p) => ({ ...p, [field]: value }))
    setError('')
  }

  const setDayHours = (key: DayKey, patch: Partial<DayHours>) => {
    setHours((p) => ({ ...p, [key]: { ...p[key], ...patch } }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) {
      setError('You must be logged in to complete onboarding')
      return
    }

    if (!formData.business_name.trim() || !formData.phone.trim() || !formData.email.trim()
        || !formData.address.trim() || !formData.city.trim()) {
      setError('Please fill in business name, phone, email, address, and city.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/vendor/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name:        formData.business_name.trim(),
          description:          formData.description.trim() || null,
          category:             formData.category,
          phone:                formData.phone.trim(),
          email:                formData.email.trim(),
          address:              formData.address.trim(),
          city:                 formData.city.trim(),
          state:                formData.state.trim() || null,
          zip_code:             formData.zip_code.trim() || null,
          hours,
          kyc_business_license: formData.kyc_business_license.trim() || null,
          kyc_tax_id:           formData.kyc_tax_id.trim() || null,
          payout_method:        formData.payout_method,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          // Already onboarded — silently bounce to the dashboard.
          router.push('/dashboard/vendor')
          return
        }
        setError(json?.message || json?.error || 'Failed to create vendor profile.')
        return
      }

      if (json.geocoded === false) {
        // Onboarding succeeded but no coordinates were resolved. Surface this so
        // the vendor knows they won't appear in proximity search until fixed.
        console.warn('[onboarding] address could not be geocoded')
      }

      setSuccess(true)
      setTimeout(() => router.push('/dashboard/vendor'), 1800)
    } catch (err) {
      console.error('[onboarding] unexpected error', err)
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
              <CardTitle className="text-green-800">You&apos;re on the map.</CardTitle>
              <CardDescription>
                We&apos;ve placed your shop on the local marketplace — customers nearby can find you now.
                Taking you to your dashboard…
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-2xl pt-8 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Store className="h-8 w-8 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">List your business</CardTitle>
              <CardDescription>
                A few details and your shop is live for nearby customers.
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
                    value={formData.business_name}
                    onChange={(e) => setField('business_name', e.target.value)}
                    placeholder="e.g. Sai General Store"
                    required
                  />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">What do you sell?</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setField('description', e.target.value)}
                    placeholder="Briefly describe your products or services (optional)"
                    className="w-full min-h-[80px] px-3 py-2 border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none rounded-md"
                  />
                </div>

                {/* Category */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Business Type *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {businessCategories.map((c) => (
                      <label
                        key={c.value}
                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800 ${
                          formData.category === c.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="category"
                          value={c.value}
                          checked={formData.category === c.value}
                          onChange={(e) => setField('category', e.target.value)}
                          className="sr-only"
                        />
                        <span className="text-2xl">{c.icon}</span>
                        <span className="font-medium">{c.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Contact */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Contact</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        Phone *
                      </label>
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setField('phone', e.target.value)}
                        placeholder="+91 98765 43210"
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
                        onChange={(e) => setField('email', e.target.value)}
                        placeholder="business@example.com"
                        required
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Address — used to put you on the map */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Where you are
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    We use this to show your shop to customers nearby. Be specific so the pin lands on your door.
                  </p>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Street Address *</label>
                      <Input
                        value={formData.address}
                        onChange={(e) => setField('address', e.target.value)}
                        placeholder="Shop No. 12, MG Road"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">City *</label>
                        <Input
                          value={formData.city}
                          onChange={(e) => setField('city', e.target.value)}
                          placeholder="Pune"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">State / Region</label>
                        <Input
                          value={formData.state}
                          onChange={(e) => setField('state', e.target.value)}
                          placeholder="Maharashtra"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">PIN / ZIP</label>
                        <Input
                          value={formData.zip_code}
                          onChange={(e) => setField('zip_code', e.target.value)}
                          placeholder="411001"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Hours */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    When you&apos;re open
                  </h3>
                  <div className="space-y-2">
                    {days.map(({ key, label }) => {
                      const d = hours[key]
                      return (
                        <div key={key} className="flex items-center gap-3 text-sm">
                          <div className="w-10 font-medium">{label}</div>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!d.closed}
                              onChange={(e) => setDayHours(key, { closed: !e.target.checked })}
                            />
                            <span>{d.closed ? 'Closed' : 'Open'}</span>
                          </label>
                          {!d.closed && (
                            <>
                              <Input
                                type="time"
                                value={d.open}
                                onChange={(e) => setDayHours(key, { open: e.target.value })}
                                className="w-28"
                              />
                              <span className="text-muted-foreground">to</span>
                              <Input
                                type="time"
                                value={d.close}
                                onChange={(e) => setDayHours(key, { close: e.target.value })}
                                className="w-28"
                              />
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <Separator />

                {/* KYC */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5" />
                    Verification (optional now, required to receive payouts)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Business License #</label>
                      <Input
                        value={formData.kyc_business_license}
                        onChange={(e) => setField('kyc_business_license', e.target.value)}
                        placeholder="License number"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Tax ID / GSTIN</label>
                      <Input
                        value={formData.kyc_tax_id}
                        onChange={(e) => setField('kyc_tax_id', e.target.value)}
                        placeholder="Tax registration"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Payout */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Wallet className="h-5 w-5" />
                    How you get paid
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {([
                      { value: 'stripe_connect', label: 'Stripe Connect',
                        sub: 'Recommended — instant payouts after delivery' },
                      { value: 'manual_bank',    label: 'Manual Bank Transfer',
                        sub: 'Bank details handled later by support' },
                    ] as const).map((p) => (
                      <label
                        key={p.value}
                        className={`flex flex-col gap-1 p-3 border rounded-lg cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-800 ${
                          formData.payout_method === p.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="payout_method"
                            value={p.value}
                            checked={formData.payout_method === p.value}
                            onChange={(e) => setField('payout_method', e.target.value)}
                          />
                          <span className="font-medium">{p.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground pl-6">{p.sub}</span>
                      </label>
                    ))}
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
                        Putting you on the map…
                      </>
                    ) : (
                      'Go live'
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
