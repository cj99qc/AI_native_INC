'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Store, 
  Package, 
  DollarSign, 
  ShoppingCart,
  TrendingUp,
  Star,
  Plus,
  Eye,
  Edit,
  BarChart3
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'

type Product = {
  id: string
  name: string
  description: string
  price: number
  image_url?: string
  category: string
  inventory_count: number
  created_at: string
}

type Order = {
  id: string
  status: string
  total: number
  created_at: string
  customer: {
    name?: string
    id: string
  }[]
}

type Business = {
  id: string
  name: string
  description?: string
  business_type: string
  location?: Record<string, unknown>
  phone?: string
  email?: string
}

type SponsoredListing = {
  id: string
  product_id: string
  daily_budget: number
  status: string
  created_at: string
  product: {
    name: string
    price: number
  }[]
}

export default function VendorDashboard() {
  const { user, isVendor, isAdmin } = useAuth()
  const supabase = useSupabase()
  const router = useRouter()
  
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [sponsoredListings, setSponsoredListings] = useState<SponsoredListing[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  
  // Stats
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    totalProducts: 0,
    recentOrdersCount: 0
  })

  useEffect(() => {
    if (!user) return
    fetchDashboardData()
  }, [user])

  // Role protection
  if (!loading && user && !isVendor && !isAdmin) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <h2 className="text-lg font-semibold text-red-800">Access Denied</h2>
          <p className="text-red-700">This dashboard is only accessible to vendors.</p>
        </div>
      </div>
    )
  }

  const fetchDashboardData = async () => {
    if (!user) return
    
    try {
      setLoading(true)

      // Fetch business profile
      const { data: businessData } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)
        .single()

      // Fetch products
      const { data: productsData } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', user.id)
        .order('created_at', { ascending: false })

      // Fetch orders for this vendor
      const { data: ordersData } = await supabase
        .from('orders')
        .select(`
          id,
          status,
          total,
          created_at,
          customer:profiles!customer_id(id, name)
        `)
        .eq('vendor_id', user.id)
        .order('created_at', { ascending: false })

      // Fetch sponsored listings
      const { data: sponsoredData } = await supabase
        .from('sponsored_listings')
        .select(`
          id,
          product_id,
          daily_budget,
          status,
          created_at,
          product:products!product_id(name, price)
        `)
        .eq('vendor_id', user.id)
        .order('created_at', { ascending: false })

      // Calculate stats
      const totalRevenue = ordersData?.reduce((sum, order) => 
        order.status === 'delivered' ? sum + order.total : sum, 0) || 0
      const totalOrders = ordersData?.length || 0
      const totalProducts = productsData?.length || 0
      const recentOrdersCount = ordersData?.filter(order => 
        new Date(order.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      ).length || 0

      setBusiness(businessData)
      setProducts(productsData || [])
      setOrders(ordersData || [])
      setSponsoredListings(sponsoredData || [])
      setStats({
        totalRevenue,
        totalOrders,
        totalProducts,
        recentOrdersCount
      })
    } catch (error) {
      console.error('Error fetching vendor dashboard data:', error)
    } finally {
      setLoading(false)
    }
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!business) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-6 text-center">
          <Store className="h-12 w-12 mx-auto text-blue-600 mb-4" />
          <h2 className="text-xl font-semibold text-blue-800 mb-2">Complete Your Business Setup</h2>
          <p className="text-blue-700 mb-4">You need to set up your business profile before accessing the vendor dashboard.</p>
          <Link href="/vendor/onboarding">
            <Button>Complete Business Setup</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Business Dashboard</h1>
          <p className="text-gray-600">Welcome back, {business.name}!</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/vendor/products">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </Link>
          <Link href="/vendor/analytics">
            <Button variant="outline">
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Revenue</p>
                <p className="text-2xl font-bold">${stats.totalRevenue.toFixed(2)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Orders</p>
                <p className="text-2xl font-bold">{stats.totalOrders}</p>
              </div>
              <ShoppingCart className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Products Listed</p>
                <p className="text-2xl font-bold">{stats.totalProducts}</p>
              </div>
              <Package className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Recent Orders</p>
                <p className="text-2xl font-bold">{stats.recentOrdersCount}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="sponsored">Sponsored</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Orders */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Orders</CardTitle>
                <CardDescription>Your latest customer orders</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {orders.slice(0, 5).map((order) => (
                  <div key={order.id} className="flex justify-between items-center p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">Order #{order.id.slice(-6)}</p>
                      <p className="text-sm text-gray-600">
                        {order.customer?.[0]?.name || 'Anonymous'} • {new Date(order.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">${order.total.toFixed(2)}</p>
                      <Badge className={getStatusColor(order.status)}>
                        {order.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {orders.length === 0 && (
                  <div className="text-center py-4">
                    <ShoppingCart className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-600">No orders yet</p>
                    <p className="text-sm text-gray-500">Orders will appear here when customers purchase your products</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Products */}
            <Card>
              <CardHeader>
                <CardTitle>Your Products</CardTitle>
                <CardDescription>Recently added products</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {products.slice(0, 5).map((product) => (
                  <div key={product.id} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="w-12 h-12 bg-gray-100 rounded-md flex items-center justify-center">
                      {product.image_url ? (
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          width={48}
                          height={48}
                          className="object-cover rounded-md"
                        />
                      ) : (
                        <Package className="h-6 w-6 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{product.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{product.category}</Badge>
                        <span className="text-sm text-gray-600">{product.inventory_count} in stock</span>
                      </div>
                    </div>
                    <p className="font-semibold">${product.price}</p>
                  </div>
                ))}
                {products.length === 0 && (
                  <div className="text-center py-4">
                    <Package className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-600">No products yet</p>
                    <Link href="/vendor/products">
                      <Button size="sm" className="mt-2">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Your First Product
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Products Tab */}
        <TabsContent value="products" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Your Products</h2>
            <Link href="/vendor/products">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add New Product
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <Card key={product.id}>
                <div className="aspect-video bg-gray-100 rounded-t-lg relative overflow-hidden">
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
                <CardContent className="p-4">
                  <h4 className="font-semibold mb-2">{product.name}</h4>
                  <p className="text-sm text-gray-600 mb-3">{product.description}</p>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="secondary">{product.category}</Badge>
                    <Badge variant={product.inventory_count > 0 ? "default" : "destructive"}>
                      {product.inventory_count} in stock
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold">${product.price}</span>
                    <div className="flex gap-2">
                      <Link href={`/product/${product.id}`}>
                        <Button size="sm" variant="outline">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button size="sm" variant="outline">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {products.length === 0 && (
            <div className="text-center py-12">
              <Package className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No products yet</h3>
              <p className="text-gray-600 mb-4">Start by adding your first product to your store</p>
              <Link href="/vendor/products">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Product
                </Button>
              </Link>
            </div>
          )}
        </TabsContent>

        {/* Orders Tab */}
        <TabsContent value="orders" className="space-y-6">
          <h2 className="text-xl font-semibold">Order Management</h2>
          
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {orders.map((order) => (
                  <div key={order.id} className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold">Order #{order.id.slice(-8)}</p>
                        <p className="text-sm text-gray-600">
                          Customer: {order.customer?.[0]?.name || 'Anonymous'}
                        </p>
                        <p className="text-sm text-gray-600">
                          Date: {new Date(order.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">${order.total.toFixed(2)}</p>
                        <Badge className={getStatusColor(order.status)}>
                          {order.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex justify-end mt-3">
                      <Link href={`/vendor/orders/${order.id}`}>
                        <Button size="sm" variant="outline">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
              
              {orders.length === 0 && (
                <div className="text-center py-12">
                  <ShoppingCart className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No orders yet</h3>
                  <p className="text-gray-600">Orders from customers will appear here</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sponsored Listings Tab */}
        <TabsContent value="sponsored" className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Sponsored Listings</h2>
              <p className="text-gray-600">Promote your products to reach more customers</p>
            </div>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Sponsored Ad
            </Button>
          </div>

          <div className="grid gap-4">
            {sponsoredListings.map((listing) => (
              <Card key={listing.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold">{listing.product?.[0]?.name || 'Unknown Product'}</h4>
                      <p className="text-sm text-gray-600">Daily Budget: ${listing.daily_budget}</p>
                      <p className="text-sm text-gray-600">
                        Created: {new Date(listing.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge className={listing.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                        {listing.status}
                      </Badge>
                      <p className="text-sm text-gray-600 mt-1">Product: ${listing.product?.[0]?.price || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {sponsoredListings.length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <Star className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No sponsored listings</h3>
                <p className="text-gray-600 mb-4">Promote your products to increase visibility and sales</p>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Sponsored Ad
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}