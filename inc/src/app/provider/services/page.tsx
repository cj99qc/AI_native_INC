'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Briefcase, Plus, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { z } from 'zod'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

// Form values use rupees (decimal) for display; we convert to paise (cents)
// before sending to the API.
const serviceRow = z.object({
  id: z.string().optional(),
  service_slug: z.string().min(1, 'Category required'),
  display_name: z.string().min(1, 'Service name required').max(200),
  description: z.string().max(1000, 'Description too long (max 1000 chars)').optional().or(z.literal('')),
  price_strategy: z.enum(['flat', 'hourly', 'quote']),
  base_price_rupees: z.number().nonnegative().optional().nullable(),
  hourly_rate_rupees: z.number().nonnegative().optional().nullable(),
  min_charge_rupees: z.number().nonnegative().optional().nullable(),
  estimated_duration_minutes: z.number().int().nonnegative().optional().nullable(),
  is_active: z.boolean().default(true),
}).superRefine((row, ctx) => {
  if (row.price_strategy === 'flat' && (row.base_price_rupees == null || row.base_price_rupees <= 0)) {
    ctx.addIssue({ code: 'custom', path: ['base_price_rupees'], message: 'Flat rate needs a price' })
  }
  if (row.price_strategy === 'hourly' && (row.hourly_rate_rupees == null || row.hourly_rate_rupees <= 0)) {
    ctx.addIssue({ code: 'custom', path: ['hourly_rate_rupees'], message: 'Hourly rate needs a price' })
  }
})

const serviceSchema = z.object({
  services: z.array(serviceRow),
})

// Use the OUTPUT type so `is_active` (which has a default) is treated as
// required in the submit handler. react-hook-form can still accept partial
// rows on append() because the schema applies the defaults.
type ServiceFormData = z.output<typeof serviceSchema>
type ServiceFormInput = z.input<typeof serviceSchema>

const toCents = (rupees: number | null | undefined): number | null => {
  if (rupees == null || isNaN(rupees)) return null
  return Math.round(rupees * 100)
}

const toRupees = (cents: number | null | undefined): number | null => {
  if (cents == null) return null
  return cents / 100
}

export default function ProviderServicesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: categoriesData } = useQuery({
    queryKey: ['service-categories'],
    queryFn: async () => {
      const res = await fetch('/api/service-categories')
      if (!res.ok) throw new Error('Failed to fetch categories')
      return res.json()
    },
    enabled: !!user,
  })
  const categories: { slug: string; name: string }[] = categoriesData?.categories ?? []

  const { data: servicesData, isLoading: servicesLoading, refetch } = useQuery({
    queryKey: ['provider-services'],
    queryFn: async () => {
      const res = await fetch('/api/provider/services')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || err.error || 'Failed to fetch services')
      }
      return res.json()
    },
    enabled: !!user,
    retry: false,
  })

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting: formSubmitting },
    reset,
  } = useForm<ServiceFormInput, unknown, ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { services: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'services' })
  const services = watch('services')

  useEffect(() => {
    if (servicesData?.services) {
      reset({
        services: servicesData.services.map((s: any) => ({
          id: s.id,
          service_slug: s.service_slug,
          display_name: s.display_name,
          description: s.description ?? '',
          price_strategy: s.price_strategy,
          base_price_rupees: toRupees(s.base_price_cents),
          hourly_rate_rupees: toRupees(s.hourly_rate_cents),
          min_charge_rupees: toRupees(s.min_charge_cents),
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
    setSaving(true)

    try {
      // Build payload: convert rupees → cents, normalize empty descriptions.
      const buildPayload = (s: ServiceFormData['services'][number]) => ({
        service_slug: s.service_slug,
        display_name: s.display_name,
        description: s.description?.trim() || null,
        price_strategy: s.price_strategy,
        base_price_cents: s.price_strategy === 'flat' ? toCents(s.base_price_rupees) : null,
        hourly_rate_cents: s.price_strategy === 'hourly' ? toCents(s.hourly_rate_rupees) : null,
        min_charge_cents: s.price_strategy === 'hourly' ? toCents(s.min_charge_rupees) : null,
        estimated_duration_minutes: s.estimated_duration_minutes ?? null,
        is_active: s.is_active,
      })

      // Fan out create/update calls in parallel; collect failures.
      const writePromises = data.services.map(async (s) => {
        const payload = buildPayload(s)
        if (s.id) {
          const res = await fetch(`/api/provider/services/${s.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(`"${s.display_name}": ${err.message || err.error || 'update failed'}`)
          }
        } else {
          const res = await fetch('/api/provider/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(`"${s.display_name}": ${err.message || err.error || 'create failed'}`)
          }
        }
      })

      // Soft-delete services removed from the form.
      const remainingIds = new Set(data.services.filter((s) => s.id).map((s) => s.id))
      const deletePromises =
        servicesData?.services
          ?.filter((s: any) => !remainingIds.has(s.id))
          .map(async (s: any) => {
            const res = await fetch(`/api/provider/services/${s.id}`, { method: 'DELETE' })
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(`Delete "${s.display_name}": ${err.message || err.error || 'failed'}`)
            }
          }) ?? []

      const results = await Promise.allSettled([...writePromises, ...deletePromises])
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

      if (failures.length > 0) {
        const messages = failures.map((f) => f.reason?.message ?? 'unknown error').join('; ')
        throw new Error(
          `${results.length - failures.length} saved, ${failures.length} failed: ${messages}`
        )
      }

      setSuccess(true)
      // Refresh the cached list rather than reloading the whole page.
      await refetch()
      setTimeout(() => {
        setSuccess(false)
        router.refresh()
      }, 1500)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setSaving(false)
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
              <CardTitle className="text-green-800">Services saved</CardTitle>
              <CardDescription>Your menu is live</CardDescription>
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
              <CardDescription>List what you do, with clear pricing</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {fields.map((field, index) => {
                  const row = services[index]
                  const isExisting = !!row?.id
                  return (
                    <div key={field.id} className="space-y-4 p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/40">
                      <div className="flex justify-between items-start">
                        <h3 className="font-semibold">Service {index + 1}</h3>
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="text-red-500 hover:text-red-700"
                          aria-label="Remove service"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Category *</label>
                        <select
                          {...register(`services.${index}.service_slug`)}
                          className="w-full px-3 py-2 border border-input bg-background text-sm rounded-md"
                        >
                          <option value="">Select category</option>
                          {categories.map((cat) => (
                            <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                          ))}
                        </select>
                        {errors.services?.[index]?.service_slug && (
                          <p className="text-xs text-red-500">{errors.services[index]?.service_slug?.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Service name *</label>
                        <Input
                          {...register(`services.${index}.display_name`)}
                          placeholder="e.g. Leak repair"
                        />
                        {errors.services?.[index]?.display_name && (
                          <p className="text-xs text-red-500">{errors.services[index]?.display_name?.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Description</label>
                        <textarea
                          {...register(`services.${index}.description`)}
                          placeholder="What's included? Tools? Travel?"
                          className="w-full min-h-[80px] px-3 py-2 border border-input bg-background text-sm rounded-md resize-none"
                          maxLength={1000}
                        />
                        {errors.services?.[index]?.description && (
                          <p className="text-xs text-red-500">{errors.services[index]?.description?.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Pricing model *</label>
                        <select
                          {...register(`services.${index}.price_strategy`)}
                          className="w-full px-3 py-2 border border-input bg-background text-sm rounded-md"
                        >
                          <option value="quote">Quote on request</option>
                          <option value="flat">Flat rate</option>
                          <option value="hourly">Hourly rate</option>
                        </select>
                      </div>

                      {row?.price_strategy === 'flat' && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Price (₹) *</label>
                          <Input
                            {...register(`services.${index}.base_price_rupees`, { valueAsNumber: true })}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="e.g. 80"
                          />
                          <p className="text-xs text-gray-500">Enter the amount in rupees (e.g. 80 for ₹80.00).</p>
                          {errors.services?.[index]?.base_price_rupees && (
                            <p className="text-xs text-red-500">{errors.services[index]?.base_price_rupees?.message}</p>
                          )}
                        </div>
                      )}

                      {row?.price_strategy === 'hourly' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Hourly rate (₹) *</label>
                            <Input
                              {...register(`services.${index}.hourly_rate_rupees`, { valueAsNumber: true })}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="e.g. 40"
                            />
                            {errors.services?.[index]?.hourly_rate_rupees && (
                              <p className="text-xs text-red-500">{errors.services[index]?.hourly_rate_rupees?.message}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Minimum charge (₹)</label>
                            <Input
                              {...register(`services.${index}.min_charge_rupees`, { valueAsNumber: true })}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Optional"
                            />
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Est. duration (minutes)</label>
                        <Input
                          {...register(`services.${index}.estimated_duration_minutes`, { valueAsNumber: true })}
                          type="number"
                          step="15"
                          min="0"
                          placeholder="e.g. 60"
                        />
                      </div>

                      {isExisting && (
                        <p className="text-xs text-gray-500">
                          Existing service — changing the category will move this listing.
                        </p>
                      )}
                    </div>
                  )
                })}

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

                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    append({
                      service_slug: '',
                      display_name: '',
                      description: '',
                      price_strategy: 'quote',
                      base_price_rupees: null,
                      hourly_rate_rupees: null,
                      min_charge_rupees: null,
                      estimated_duration_minutes: null,
                      is_active: true,
                    })
                  }
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add another service
                </Button>

                <div className="flex gap-4">
                  <Link href="/dashboard/provider" className="flex-1">
                    <Button type="button" variant="outline" className="w-full">Back</Button>
                  </Link>
                  <Button type="submit" disabled={formSubmitting || saving} className="flex-1">
                    {formSubmitting || saving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save services'
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
