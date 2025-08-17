'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { useCart } from '@/providers/CartProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { VoiceSearch } from '@/components/ui/VoiceSearch'
import { 
  Search, 
  ShoppingCart, 
  Package, 
  MapPin, 
  TrendingUp,
  Plus,
  Eye
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'

type Product = {
  id: string
  name: string
  description: string
  price: number
  image_url?: string
  vendor_id: string
  category: string
  inventory_count: number
  vendor?: {
    id: string
    name: string
    business_type: string
  }
}

type Order = {
  id: string
  status: string
  total: number
  created_at: string
  vendor: {
    name: string
  }[]
}

export default function CustomerDashboard() {
  const { user, isCustomer, isAdmin } = useAuth()
  const supabase = useSupabase()
  const router = useRouter()
  const { items: cartItems, add: addToCart } = useCart()

  // Helper functions for cart
  const getTotalItems = () => cartItems.reduce((sum, item) => sum + item.quantity, 0)
  const getTotalPrice = () => cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  
  const [products, setProducts] = useState<Product[]>([])
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<string[]>([])

  useEffect(() => {
    if (!user) return
    fetchDashboardData()
  }, [user, searchQuery, selectedCategory])

  // Role protection
  if (!loading && user && !isCustomer && !isAdmin) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <h2 className="text-lg font-semibold text-red-800">Access Denied</h2>
          <p className="text-red-700">This dashboard is only accessible to customers.</p>
        </div>
      </div>
    )
  }

  const fetchDashboardData = async () => {
    if (!user) return
    
    try {
      setLoading(true)

      // Fetch products with vendor information
      let query = supabase
        .from('products')
        .select(`
          *,
          vendor:businesses!vendor_id(id, name, business_type)
        `)
        .gt('inventory_count', 0)
        .order('created_at', { ascending: false })

      if (searchQuery) {
        query = query.or(`name.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`)
      }

      if (selectedCategory !== 'all') {
        query = query.eq('category', selectedCategory)
      }

      const { data: productsData } = await query.limit(12)

      // Fetch recent orders
      const { data: ordersData } = await supabase
        .from('orders')
        .select(`
          id,
          status,
          total,
          created_at,
          vendor:businesses!vendor_id(name)
        `)
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5)

      // Fetch categories
      const { data: categoryData } = await supabase
        .from('products')
        .select('category')
        .not('category', 'is', null)

      const uniqueCategories = [...new Set(categoryData?.map(p => p.category) || [])]

      setProducts(productsData || [])
      setRecentOrders(ordersData || [])
      setCategories(uniqueCategories)
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)
  }

  const handleVoiceSearch = (transcript: string) => {
    setSearchQuery(transcript)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return 'bg-green-100 text-green-800'
      case 'shipped': return 'bg-blue-100 text-blue-800'
      case 'paid': return 'bg-yellow-100 text-yellow-800'
      case 'pending': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-4">
        <div className="space-y-4">
          <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-64 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Customer Dashboard</h1>
          <p className="text-gray-600">Welcome back, {user?.profile?.name || user?.email?.split('@')[0]}!</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/cart">
            <Button className="relative">
              <ShoppingCart className="h-4 w-4 mr-2" />
              Cart ({getTotalItems()})
              {getTotalItems() > 0 && (
                <Badge className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center">
                  {getTotalItems()}
                </Badge>
              )}
            </Button>
          </Link>
          <Link href="/orders">
            <Button variant="outline">
              <Package className="h-4 w-4 mr-2" />
              Orders
            </Button>
          </Link>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Discover Products & Services
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                type="text"
                placeholder="Search for products, businesses, services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-12"
              />
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                <VoiceSearch onSearch={handleVoiceSearch} />
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => router.push(`/search?q=${encodeURIComponent(searchQuery)}`)}
            >
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory('all')}
            >
              All Categories
            </Button>
            {categories.map(category => (
              <Button
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Cart Items</p>
                <p className="text-2xl font-bold">{getTotalItems()}</p>
              </div>
              <ShoppingCart className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Cart Total</p>
                <p className="text-2xl font-bold">${getTotalPrice().toFixed(2)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Recent Orders</p>
                <p className="text-2xl font-bold">{recentOrders.length}</p>
              </div>
              <Package className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Available Products</p>
                <p className="text-2xl font-bold">{products.length}</p>
              </div>
              <Eye className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Products */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Featured Products</CardTitle>
              <CardDescription>
                {searchQuery ? `Search results for "${searchQuery}"` : `Fresh products from local businesses`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {products.map((product) => (
                  <div key={product.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="aspect-video bg-gray-100 rounded-md mb-3 relative overflow-hidden">
                      {product.image_url ? (
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                          <Package className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                    <h4 className="font-semibold">{product.name}</h4>
                    <p className="text-sm text-gray-600 mb-2">{product.description}</p>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary">{product.category}</Badge>
                      <Badge variant="outline">
                        {product.inventory_count} in stock
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-lg font-bold">${product.price}</span>
                      <div className="flex items-center text-sm text-gray-600">
                        <MapPin className="h-3 w-3 mr-1" />
                        {product.vendor?.name}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => addToCart({
                          productId: product.id,
                          vendorId: product.vendor_id,
                          name: product.name,
                          price: product.price,
                          quantity: 1
                        })}
                        className="flex-1"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add to Cart
                      </Button>
                      <Link href={`/product/${product.id}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>

              {products.length === 0 && (
                <div className="text-center py-8">
                  <Package className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No products found</h3>
                  <p className="text-gray-600 mb-4">
                    {searchQuery ? 'Try adjusting your search terms' : 'No products available at the moment'}
                  </p>
                  <Link href="/search">
                    <Button>
                      <Search className="h-4 w-4 mr-2" />
                      Browse All Products
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Orders */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Recent Orders
                <Link href="/orders">
                  <Button variant="outline" size="sm">View All</Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentOrders.map((order) => (
                <div key={order.id} className="border rounded-lg p-3">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium">{order.vendor?.[0]?.name || 'Unknown Vendor'}</p>
                      <p className="text-sm text-gray-600">
                        {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge className={getStatusColor(order.status)}>
                      {order.status}
                    </Badge>
                  </div>
                  <p className="text-lg font-semibold">${order.total.toFixed(2)}</p>
                </div>
              ))}
              
              {recentOrders.length === 0 && (
                <div className="text-center py-4">
                  <Package className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-gray-600">No recent orders</p>
                  <p className="text-sm text-gray-500">Start browsing to place your first order!</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/search" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Search className="h-4 w-4 mr-2" />
                  Browse Products
                </Button>
              </Link>
              <Link href="/cart" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  View Cart ({getTotalItems()})
                </Button>
              </Link>
              <Link href="/orders" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Package className="h-4 w-4 mr-2" />
                  Track Orders
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}