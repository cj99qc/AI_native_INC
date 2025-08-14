'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { VoiceSearch } from '@/components/ui/VoiceSearch'
import { MapView, type MapLocation } from '@/components/ui/MapView'
import { Carousel } from '@/components/ui/carousel'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Star, MapPin, Clock, Zap, ShoppingBag, Truck, Store, TrendingUp } from 'lucide-react'
import Link from 'next/link'

// Mock data for demo - in real app this would come from your API
const featuredProducts = [
  {
    id: '1',
    name: 'Artisan Coffee Blend',
    description: 'Premium locally roasted coffee beans',
    price: 24.99,
    image: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=400&h=300&fit=crop',
    vendor: 'Local Roasters',
    rating: 4.8,
    deliveryTime: '15-25 min'
  },
  {
    id: '2', 
    name: 'Fresh Organic Produce Box',
    description: 'Weekly selection of seasonal vegetables',
    price: 45.00,
    image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&h=300&fit=crop',
    vendor: 'Green Farm Co.',
    rating: 4.9,
    deliveryTime: '30-45 min'
  },
  {
    id: '3',
    name: 'Handcrafted Sourdough',
    description: 'Traditional sourdough bread baked daily',
    price: 8.50,
    image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&h=300&fit=crop',
    vendor: 'Corner Bakery',
    rating: 4.7,
    deliveryTime: '10-20 min'
  }
]

const nearbyVendors: MapLocation[] = [
  { lat: 40.7589, lng: -73.9851, title: 'Central Café', description: 'Coffee & Pastries', type: 'vendor' },
  { lat: 40.7505, lng: -73.9934, title: 'Fresh Market', description: 'Organic Groceries', type: 'vendor' },
  { lat: 40.7614, lng: -73.9776, title: 'Pizza Corner', description: 'Italian Cuisine', type: 'vendor' },
  { lat: 40.7527, lng: -73.9772, title: 'Green Smoothies', description: 'Health Drinks', type: 'vendor' },
]

export default function HomePage() {
  const router = useRouter()
  const [userLocation, setUserLocation] = useState<[number, number]>([40.7128, -74.0060])

  useEffect(() => {
    // Get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude])
        },
        () => {
          // Location permission denied or error
        }
      )
    }
  }, [])

  const handleSearch = (query: string) => {
    router.push(`/search?q=${encodeURIComponent(query)}`)
  }

  const handleMapMarkerClick = (location: MapLocation) => {
    console.log('Vendor clicked:', location)
    // In real app, navigate to vendor page
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative mx-auto max-w-7xl px-4 py-20 text-center"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="mb-8"
          >
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-6xl">
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                AI-Native
              </span>{' '}
              Local Logistics
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-300">
              Discover, order, and get deliveries from local businesses powered by AI. 
              Voice search, real-time tracking, and smart recommendations.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mx-auto max-w-2xl"
          >
            <VoiceSearch 
              onSearch={handleSearch}
              placeholder="Try: 'Find coffee near me' or 'Order fresh vegetables'"
              className="mb-8"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="flex flex-wrap justify-center gap-4"
          >
            {[
              { icon: Zap, label: 'AI-Powered', color: 'bg-yellow-500' },
              { icon: MapPin, label: 'Location-First', color: 'bg-blue-500' },
              { icon: Clock, label: 'Real-Time', color: 'bg-green-500' },
              { icon: Truck, label: 'Fast Delivery', color: 'bg-purple-500' }
            ].map((feature, index) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 + index * 0.1 }}
                className="flex items-center gap-2 rounded-full bg-white/80 dark:bg-gray-800/80 px-4 py-2 backdrop-blur-sm"
              >
                <div className={`rounded-full p-1 ${feature.color}`}>
                  <feature.icon className="h-3 w-3 text-white" />
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {feature.label}
                </span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-16 space-y-16">
        {/* Featured Products Carousel */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                Featured Products
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                AI-curated selections based on your preferences
              </p>
            </div>
            <Badge variant="secondary" className="bg-gradient-to-r from-blue-500 to-purple-500 text-white">
              <TrendingUp className="h-3 w-3 mr-1" />
              Trending
            </Badge>
          </div>

          <Carousel 
            autoplay 
            autoplayDelay={5000}
            className="rounded-xl overflow-hidden"
          >
            {featuredProducts.map((product) => (
              <Card key={product.id} className="border-0 shadow-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm">
                <div className="relative h-64 overflow-hidden">
                  <Image 
                    src={product.image} 
                    alt={product.name}
                    width={400}
                    height={300}
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                  <div className="absolute top-4 right-4">
                    <Badge className="bg-white/90 text-gray-900">
                      <Clock className="h-3 w-3 mr-1" />
                      {product.deliveryTime}
                    </Badge>
                  </div>
                </div>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                      {product.name}
                    </h3>
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      <span className="text-sm font-medium">{product.rating}</span>
                    </div>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 mb-3">
                    {product.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        ${product.price}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        from {product.vendor}
                      </div>
                    </div>
                    <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                      <ShoppingBag className="h-4 w-4 mr-2" />
                      Add to Cart
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </Carousel>
        </motion.section>

        {/* Map Section */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
              Explore Nearby
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Discover local businesses and services in your area
            </p>
          </div>

          <Card className="overflow-hidden border-0 shadow-xl">
            <CardContent className="p-0">
              <MapView
                center={userLocation}
                markers={nearbyVendors}
                height="500px"
                onMarkerClick={handleMapMarkerClick}
                className="w-full"
              />
            </CardContent>
          </Card>
        </motion.section>

        {/* Quick Actions */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
        >
          <h2 className="mb-8 text-3xl font-bold text-gray-900 dark:text-white">
            Quick Actions
          </h2>
          
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: 'Search Products',
                description: 'Find exactly what you need with AI-powered search',
                icon: Zap,
                href: '/search',
                color: 'from-blue-500 to-cyan-500'
              },
              {
                title: 'Browse Vendors',
                description: 'Discover local businesses and their offerings',
                icon: Store,
                href: '/vendors',
                color: 'from-green-500 to-emerald-500'
              },
              {
                title: 'Track Orders',
                description: 'Real-time tracking of your deliveries',
                icon: Truck,
                href: '/orders',
                color: 'from-purple-500 to-pink-500'
              }
            ].map((action, index) => (
              <motion.div
                key={action.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1, duration: 0.6 }}
                viewport={{ once: true }}
              >
                <Link href={action.href}>
                  <Card className="group cursor-pointer border-0 shadow-lg transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900">
                    <CardContent className="p-6">
                      <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-r ${action.color} mb-4 group-hover:scale-110 transition-transform duration-300`}>
                        <action.icon className="h-6 w-6 text-white" />
                      </div>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                        {action.title}
                      </h3>
                      <p className="text-gray-600 dark:text-gray-400">
                        {action.description}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.section>
      </div>
    </div>
  )
}
