import { createServerSupabase } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Star, MapPin, Clock, Phone } from 'lucide-react'

function isOpenNow(hours: Record<string, any>, timezone: string): boolean {
  if (!hours || typeof hours !== 'object') return true

  const now = new Date()
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const todayKey = dayNames[now.getDay()]

  const todayHours = hours[todayKey]
  if (!todayHours) return false
  if (todayHours.closed) return false

  const openTime = todayHours.open ? parseInt(todayHours.open.replace(':', '')) : 0
  const closeTime = todayHours.close ? parseInt(todayHours.close.replace(':', '')) : 2359
  const currentTime = now.getHours() * 100 + now.getMinutes()

  return currentTime >= openTime && currentTime < closeTime
}

function formatPrice(cents: number | null, strategy: string): string {
  if (!cents) {
    if (strategy === 'quote') return 'Quote on request'
    return 'Contact for pricing'
  }
  return `₹${(cents / 100).toFixed(2)}`
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createServerSupabase()

  // Fetch the service category
  const { data: category } = await supabase
    .from('service_categories')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!category) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-semibold text-gray-700">Service not found</h2>
            <p className="text-gray-600 mb-4">This service category doesn't exist.</p>
            <Link href="/services">
              <Button>Back to services</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Fetch providers offering this service
  const { data: services } = await supabase
    .from('provider_services')
    .select(`
      *,
      provider:provider_id(
        id,
        name,
        description,
        location,
        hours,
        timezone,
        contact_info
      )
    `)
    .eq('service_slug', slug)
    .eq('is_active', true)
    .eq('provider.is_active', true)
    .order('display_name', { ascending: true })

  const providers = services
    ? Array.from(new Map(services.map((s: any) => [s.provider_id, s])).values())
    : []

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-4xl pt-8 pb-12">
        {/* Header */}
        <div className="mb-8">
          <Link href="/services" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
            ← Back to services
          </Link>
          <h1 className="text-4xl font-bold mb-2">{category.name}</h1>
          <p className="text-gray-600 dark:text-gray-300">{category.description}</p>
        </div>

        {/* Providers List */}
        {providers.length > 0 ? (
          <div className="space-y-6">
            {providers.map((item: any) => {
              const provider = item.provider
              const open = isOpenNow(provider.hours, provider.timezone)

              return (
                <Card key={provider.id} className="overflow-hidden">
                  <CardHeader className="pb-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <CardTitle className="text-2xl mb-2">{provider.name}</CardTitle>
                        <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            <span>Near you</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            <span>4.8 (24 reviews)</span>
                          </div>
                        </div>
                      </div>
                      <Badge variant={open ? 'default' : 'secondary'} className="h-fit">
                        <Clock className="h-3 w-3 mr-1" />
                        {open ? 'Open now' : 'Closed'}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-6">
                    {/* Provider Description */}
                    {provider.description && (
                      <p className="text-gray-700 dark:text-gray-300">{provider.description}</p>
                    )}

                    {/* Services Offered */}
                    <div>
                      <h4 className="font-semibold mb-3">Services offered</h4>
                      <div className="space-y-3">
                        {services
                          ?.filter((s: any) => s.provider_id === provider.id)
                          .map((service: any) => (
                            <div
                              key={service.id}
                              className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <h5 className="font-medium">{service.display_name}</h5>
                                  {service.description && (
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                      {service.description}
                                    </p>
                                  )}
                                  {service.estimated_duration_minutes && (
                                    <p className="text-xs text-gray-500 mt-2">
                                      Est. {service.estimated_duration_minutes} min
                                    </p>
                                  )}
                                </div>
                                <div className="text-right ml-4">
                                  <p className="font-semibold text-lg">
                                    {service.price_strategy === 'flat' &&
                                      formatPrice(service.base_price_cents, service.price_strategy)}
                                    {service.price_strategy === 'hourly' &&
                                      formatPrice(service.hourly_rate_cents, service.price_strategy)}
                                    {service.price_strategy === 'quote' && 'Quote'}
                                  </p>
                                  {service.price_strategy === 'hourly' && (
                                    <p className="text-xs text-gray-500">/hour</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Contact */}
                    <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <Button variant="outline" className="flex-1">
                        <Phone className="h-4 w-4 mr-2" />
                        Contact
                      </Button>
                      <Button className="flex-1">Book Now</Button>
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
                No {category.name.toLowerCase()} providers are available in your area yet.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
