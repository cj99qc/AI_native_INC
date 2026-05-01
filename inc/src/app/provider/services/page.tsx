'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Briefcase, Plus, Loader2, AlertCircle, Edit, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { z } from 'zod'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

const serviceSchema = z.object({
  services: z.array(z.object({
    id: z.string().optional(),
    service_slug: z.string().min(1, 'Category required'),
    display_name: z.string().min(1, 'Service name required'),
    description: z.string().optional(),
    price_strategy: z.enum(['flat', 'hourly', 'quote']),
    base_price_cents: z.number().int().min(0).optional(),
    hourly_rate_cents: z.number().int().min(0).optional(),
    min_charge_cents: z.number().int().min(0).optional(),
    estimated_duration_minutes: z.number().int().min(0).optional(),
    is_active: z.boolean().default(true),
  })).min(0),
})

type ServiceFormData = z.infer<typeof serviceSchema>

export default function ProviderServicesPage() {
  const { user, loading: authLoading } = useAuth()
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: categoriesData } = useQuery({
    queryKey: ['service-categories'],
    queryFn: async () => {
      const res = await fetch('/api/service-categories')
      if (!res.ok) throw new Error('Failed to fetch categories')
      return res.json()
    },
    enabled: !!user,
  })
  const categories = categoriesData?.categories || []

  const { data: servicesData, isLoading: servicesLoading } = useQuery({
    queryKey: ['provider-services'],
    queryFn: async () => {
      const res = await fetch('/api/provider/services')
      if (!res.ok) throw new Error('Failed to fetch services')
      return res.json()
    },
    enabled: !!user,
  })

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting: formSubmitting },
    reset,
  } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      services: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'services',
  })

  const services = watch('services')

  useEffect(() => {
    if (servicesData?.services) {
      reset({
        services: servicesData.services.map((s: any) => ({
          id: s.id,
          service_slug: s.service_slug,
          display_name: s.display_name,
          description: s.description,
          price_strategy: s.price_strategy,
          base_price_cents: s.base_price_cents,
          hourly_rate_cents: s.hourly_rate_cents,
          min_charge_cents: s.min_charge_cents,
          estimated_duration_minutes: s.estimated_duration_minutes,
          is_active: s.is_active,
        })),
      })
    }
  }, [servicesData, reset])

  if (authLoading || servicesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in to manage services</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/auth/login">
              <Button className="w-full">Sign in</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const onSubmit = async (data: ServiceFormData) => {
    setSubmitError('')
    setIsSubmitting(true)

    try {
      for (const service of data.services) {
        if (service.id) {
          // Update existing service
          const res = await fetch(`/api/provider/services/${service.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              display_name: service.display_name,
              description: service.description,
              price_strategy: service.price_strategy,
              base_price_cents: service.base_price_cents || null,
              hourly_rate_cents: service.hourly_rate_cents || null,
              min_charge_cents: service.min_charge_cents || null,
              estimated_duration_minutes: service.estimated_duration_minutes || null,
              is_active: service.is_active,
            }),
          })
          if (!res.ok) throw new Error(`Failed to update service: ${service.display_name}`)
        } else {
          // Create new service
          const res = await fetch('/api/provider/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_slug: service.service_slug,
              display_name: service.display_name,
              description: service.description,
              price_strategy: service.price_strategy,
              base_price_cents: service.base_price_cents || null,
              hourly_rate_cents: service.hourly_rate_cents || null,
              min_charge_cents: service.min_charge_cents || null,
              estimated_duration_minutes: service.estimated_duration_minutes || null,
            }),
          })
          if (!res.ok) throw new Error(`Failed to create service: ${service.display_name}`)
        }
      }

      // Delete removed services (those that were deleted from form)
      if (servicesData?.services) {
        const remainingIds = new Set(services.filter(s => s.id).map(s => s.id))
        for (const service of servicesData.services) {
          if (!remainingIds.has(service.id)) {
            await fetch(`/api/provider/services/${service.id}`, { method: 'DELETE' })
          }
        }
      }

      setSuccess(true)
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <Briefcase className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-green-800">Services saved!</CardTitle>
              <CardDescription>Returning to your services…</CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-3xl pt-8 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Briefcase className="h-8 w-8 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">Your services</CardTitle>
              <CardDescription>List your services with pricing and availability</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* Services List */}
                {fields.map((field, index) => (
                  <div key={field.id} className="space-y-4 p-4 border rounded-lg bg-gray-50">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold">Service {index + 1}</h3>
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Service Category */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Category *</label>
                      <select
                        {...register(`services.${index}.service_slug`)}
                        className="w-full px-3 py-2 border border-input bg-background text-sm rounded-md"
                      >
                        <option value="">Select category</option>
                        {categories.map((cat: any) => (
                          <option key={cat.slug} value={cat.slug}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                      {errors.services?.[index]?.service_slug && (
                        <p className="text-xs text-red-500">{errors.services[index]?.service_slug?.message}</p>
                      )}
                    </div>

                    {/* Service Name */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Service Name *</label>
                      <Input
                        {...register(`services.${index}.display_name`)}
                        placeholder="e.g. Leak Repair"
                      />
                      {errors.services?.[index]?.display_name && (
                        <p className="text-xs text-red-500">{errors.services[index]?.display_name?.message}</p>
                      )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Description</label>
                      <textarea
                        {...register(`services.${index}.description`)}
                        placeholder="Describe this service"
                        className="w-full min-h-[80px] px-3 py-2 border border-input bg-background text-sm rounded-md resize-none"
                      />
                    </div>

                    {/* Price Strategy */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Pricing Model *</label>
                      <select
                        {...register(`services.${index}.price_strategy`)}
                        className="w-full px-3 py-2 border border-input bg-background text-sm rounded-md"
                      >
                        <option value="">Select model</option>
                        <option value="flat">Flat Rate</option>
                        <option value="hourly">Hourly Rate</option>
                        <option value="quote">Quote on Request</option>
                      </select>
                    </div>

                    {/* Pricing Fields - Show based on strategy */}
                    {services[index]?.price_strategy === 'flat' && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Base Price (₹) *</label>
                        <Input
                          {...register(`services.${index}.base_price_cents`, { valueAsNumber: true })}
                          type="number"
                          step="1"
                          min="0"
                          placeholder="Price in rupees (e.g., 8000 for ₹80.00)"
                        />
                        <p className="text-xs text-gray-500">Enter in paise (1 rupee = 100 paise)</p>
                      </div>
                    )}

                    {services[index]?.price_strategy === 'hourly' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Hourly Rate (₹) *</label>
                          <Input
                            {...register(`services.${index}.hourly_rate_cents`, { valueAsNumber: true })}
                            type="number"
                            step="1"
                            min="0"
                            placeholder="Rate in rupees"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Minimum Charge (₹)</label>
                          <Input
                            {...register(`services.${index}.min_charge_cents`, { valueAsNumber: true })}
                            type="number"
                            step="1"
                            min="0"
                            placeholder="Minimum charge"
                          />
                        </div>
                      </div>
                    )}

                    {/* Estimated Duration */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Est. Duration (minutes)</label>
                      <Input
                        {...register(`services.${index}.estimated_duration_minutes`, { valueAsNumber: true })}
                        type="number"
                        step="15"
                        min="0"
                        placeholder="e.g. 60"
                      />
                    </div>
                  </div>
                ))}

                {submitError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3 rounded-lg bg-red-50 border border-red-200 flex gap-2"
                  >
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{submitError}</p>
                  </motion.div>
                )}

                <Separator />

                {/* Add Service Button */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    append({
                      service_slug: '',
                      display_name: '',
                      description: '',
                      price_strategy: 'quote',
                      is_active: true,
                    })
                  }
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add another service
                </Button>

                {/* Action Buttons */}
                <div className="flex gap-4">
                  <Link href="/dashboard/provider" className="flex-1">
                    <Button type="button" variant="outline" className="w-full">
                      Back
                    </Button>
                  </Link>
                  <Button type="submit" disabled={formSubmitting || isSubmitting} className="flex-1">
                    {formSubmitting || isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save Services'
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
