import { createServerSupabase } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Clock, Phone } from 'lucide-react'

type Hours = Record<string, { open?: string; close?: string; closed?: boolean }>

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/**
 * Decide whether a provider is open right now in their local timezone.
 * Hours JSONB is keyed by short weekday name (mon/tue/...) with `open`/`close`
 * strings in HH:MM 24-hour format and an optional `closed` boolean.
 */
function isOpenNow(hours: Hours | null | undefined, timezone: string): boolean | null {
  if (!hours || typeof hours !== 'object' || Object.keys(hours).length === 0) {
    return null // unknown — caller should hide the badge
  }

  // Use Intl to derive the provider's local weekday + time. This is correct
  // even when the server's TZ differs from the provider's (e.g. UTC server,
  // Asia/Kolkata provider).
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Asia/Kolkata',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
  } catch {
    return null
  }

  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = part('weekday').toLowerCase().slice(0, 3) // 'mon', 'tue', ...
  const hh = parseInt(part('hour'), 10)
  const mm = parseInt(part('minute'), 10)
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null

  const today = hours[weekday]
  if (!today || today.closed || !today.open || !today.close) return false

  const parseHM = (s: string): number | null => {
    const [h, m] = s.split(':').map((x) => parseInt(x, 10))
    if (Number.isNaN(h) || Number.isNaN(m)) return null
    return h * 60 + m
  }

  const nowMin = hh * 60 + mm
  const openMin = parseHM(today.open)
  const closeMin = parseHM(today.close)
  if (openMin == null || closeMin == null) return null

  // Handle overnight ranges (e.g. open 18:00 close 02:00 next day).
  if (closeMin <= openMin) {
    return nowMin >= openMin || nowMin < closeMin
  }
  return nowMin >= openMin && nowMin < closeMin
}

function formatPrice(service: {
  price_strategy: string
  base_price_cents: number | null
  hourly_rate_cents: number | null
}): string {
  if (service.price_strategy === 'flat' && service.base_price_cents != null) {
    return `₹${(service.base_price_cents / 100).toFixed(2)}`
  }
  if (service.price_strategy === 'hourly' && service.hourly_rate_cents != null) {
    return `₹${(service.hourly_rate_cents / 100).toFixed(2)}/hr`
  }
  return 'Quote on request'
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createServerSupabase()

  const { data: category } = await supabase
    .from('service_categories')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (!category) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-semibold text-gray-700">Service not found</h2>
            <p className="text-gray-600 mb-4">This service category doesn&apos;t exist.</p>
            <Link href="/services">
              <Button>Back to services</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Use !inner so the provider filter actually constrains the join. Without
  // !inner, .eq('provider.is_active', true) is a no-op in PostgREST.
  const { data: rows } = await supabase
    .from('provider_services')
    .select(`
      id,
      provider_id,
      display_name,
      description,
      price_strategy,
      base_price_cents,
      hourly_rate_cents,
      estimated_duration_minutes,
      provider:provider_id!inner(
        id,
        name,
        description,
        hours,
        timezone,
        contact_info,
        is_active
      )
    `)
    .eq('service_slug', slug)
    .eq('is_active', true)
    .eq('provider.is_active', true)
    .order('display_name', { ascending: true })

  // Group services under each provider.
  type ServiceRow = NonNullable<typeof rows>[number]
  const providers = new Map<
    string,
    {
      provider: ServiceRow['provider']
      services: ServiceRow[]
    }
  >()
  for (const row of rows ?? []) {
    const pid = (row.provider as any)?.id
    if (!pid) continue
    if (!providers.has(pid)) {
      providers.set(pid, { provider: row.provider, services: [] })
    }
    providers.get(pid)!.services.push(row)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-4xl pt-8 pb-12">
        <div className="mb-8">
          <Link href="/services" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
            ← Back to services
          </Link>
          <h1 className="text-4xl font-bold mb-2">{category.name}</h1>
          {category.description && (
            <p className="text-gray-600 dark:text-gray-300">{category.description}</p>
          )}
        </div>

        {providers.size > 0 ? (
          <div className="space-y-6">
            {Array.from(providers.values()).map(({ provider, services }) => {
              const p = provider as any
              const open = isOpenNow(p.hours, p.timezone)

              return (
                <Card key={p.id} className="overflow-hidden">
                  <CardHeader className="pb-4">
                    <div className="flex justify-between items-start gap-4">
                      <CardTitle className="text-2xl">{p.name}</CardTitle>
                      {open !== null && (
                        <Badge variant={open ? 'default' : 'secondary'} className="h-fit">
                          <Clock className="h-3 w-3 mr-1" />
                          {open ? 'Open now' : 'Closed'}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-6">
                    {p.description && (
                      <p className="text-gray-700 dark:text-gray-300">{p.description}</p>
                    )}

                    <div>
                      <h4 className="font-semibold mb-3">Services offered</h4>
                      <div className="space-y-3">
                        {services.map((service) => (
                          <div
                            key={service.id}
                            className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
                          >
                            <div className="flex justify-between items-start gap-4">
                              <div className="flex-1 min-w-0">
                                <h5 className="font-medium">{service.display_name}</h5>
                                {service.description && (
                                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    {service.description}
                                  </p>
                                )}
                                {service.estimated_duration_minutes != null && (
                                  <p className="text-xs text-gray-500 mt-2">
                                    ~{service.estimated_duration_minutes} min
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-lg whitespace-nowrap">
                                  {formatPrice(service)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <Button variant="outline" className="flex-1">
                        <Phone className="h-4 w-4 mr-2" />
                        Contact
                      </Button>
                      <Button className="flex-1">Book now</Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <h3 className="text-lg font-semibold mb-2 text-gray-700">No providers yet</h3>
              <p className="text-gray-600">
                No {category.name.toLowerCase()} providers are listed yet.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
