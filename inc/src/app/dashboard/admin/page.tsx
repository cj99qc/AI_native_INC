'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts'
import { 
  Users, 
  Store, 
  Truck, 
  Package, 
  DollarSign,
  TrendingUp,
  Activity,
  ShoppingCart,
  BarChart3,
  Eye,
  AlertCircle
} from 'lucide-react'
import Link from 'next/link'

type AnalyticsEvent = {
  id: string
  user_id: string
  event_type: string
  data: Record<string, unknown>
  created_at: string
}

type UserStats = {
  totalUsers: number
  customers: number
  vendors: number
  drivers: number
  newUsersThisWeek: number
}

type BusinessStats = {
  totalOrders: number
  totalRevenue: number
  averageOrderValue: number
  completedDeliveries: number
  pendingOrders: number
}

type ActivityData = {
  date: string
  logins: number
  orders: number
  deliveries: number
  signups: number
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']

export default function AdminDashboard() {
  const { user, isAdmin } = useAuth()
  const supabase = useSupabase()
  
  const [userStats, setUserStats] = useState<UserStats>({
    totalUsers: 0,
    customers: 0,
    vendors: 0,
    drivers: 0,
    newUsersThisWeek: 0
  })
  
  const [businessStats, setBusinessStats] = useState<BusinessStats>({
    totalOrders: 0,
    totalRevenue: 0,
    averageOrderValue: 0,
    completedDeliveries: 0,
    pendingOrders: 0
  })
  
  const [activityData, setActivityData] = useState<ActivityData[]>([])
  const [recentEvents, setRecentEvents] = useState<AnalyticsEvent[]>([])
  const [eventTypeBreakdown, setEventTypeBreakdown] = useState<Array<{
    name: string
    value: number
    type: string
  }>>([])
  const [loading, setLoading] = useState(true)

  const fetchAnalyticsData = async () => {
    if (!user || !isAdmin) return
    
    try {
      setLoading(true)

      // Fetch user statistics
      const { data: profiles } = await supabase
        .from('profiles')
        .select('role, created_at')

      const roleCount = profiles?.reduce((acc, profile) => {
        acc[profile.role] = (acc[profile.role] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}

      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const newUsersThisWeek = profiles?.filter(profile => 
        new Date(profile.created_at) > oneWeekAgo
      ).length || 0

      setUserStats({
        totalUsers: profiles?.length || 0,
        customers: roleCount.customer || 0,
        vendors: roleCount.vendor || 0,
        drivers: roleCount.driver || 0,
        newUsersThisWeek
      })

      // Fetch business statistics
      const { data: orders } = await supabase
        .from('orders')
        .select('status, total, created_at')

      const { data: deliveryJobs } = await supabase
        .from('delivery_jobs')
        .select('status')

      const totalRevenue = orders?.reduce((sum, order) => 
        order.status === 'delivered' ? sum + order.total : sum, 0) || 0
      const completedDeliveries = deliveryJobs?.filter(job => job.status === 'completed').length || 0
      const pendingOrders = orders?.filter(order => ['pending', 'paid'].includes(order.status)).length || 0
      const avgOrderValue = orders?.length ? totalRevenue / orders.length : 0

      setBusinessStats({
        totalOrders: orders?.length || 0,
        totalRevenue,
        averageOrderValue: avgOrderValue,
        completedDeliveries,
        pendingOrders
      })

      // Fetch analytics events
      const { data: analyticsEvents } = await supabase
        .from('analytics_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      setRecentEvents(analyticsEvents || [])

      // Process activity data for charts
      const last7Days = Array.from({length: 7}, (_, i) => {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
        return date.toISOString().split('T')[0]
      }).reverse()

      const activityByDate = last7Days.map(date => {
        const dayEvents = analyticsEvents?.filter(event => 
          event.created_at.startsWith(date)
        ) || []
        
        const dayOrders = orders?.filter(order => 
          order.created_at.startsWith(date)
        ) || []

        const dayDeliveries = dayEvents.filter(event => 
          event.event_type === 'delivery_completed'
        ).length

        const dayLogins = dayEvents.filter(event => 
          event.event_type === 'user_login'
        ).length

        const daySignups = dayEvents.filter(event => 
          event.event_type === 'user_signup'
        ).length

        return {
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          logins: dayLogins,
          orders: dayOrders.length,
          deliveries: dayDeliveries,
          signups: daySignups
        }
      })

      setActivityData(activityByDate)

      // Event type breakdown for pie chart
      const eventTypeCounts = analyticsEvents?.reduce((acc, event) => {
        acc[event.event_type] = (acc[event.event_type] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}

      const eventTypeData = Object.entries(eventTypeCounts)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 5)
        .map(([type, count]) => ({
          name: type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: count as number,
          type: type
        }))

      setEventTypeBreakdown(eventTypeData)

    } catch (error) {
      console.error('Error fetching analytics data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user || !isAdmin) return
    fetchAnalyticsData()
  }, [user, isAdmin])

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'user_login': return <Users className="h-4 w-4" />
      case 'user_signup': return <Users className="h-4 w-4" />
      case 'order_placed': return <ShoppingCart className="h-4 w-4" />
      case 'delivery_completed': return <Truck className="h-4 w-4" />
      case 'product_viewed': return <Eye className="h-4 w-4" />
      case 'job_accepted': return <Package className="h-4 w-4" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'user_login': return 'bg-blue-100 text-blue-800'
      case 'user_signup': return 'bg-green-100 text-green-800'
      case 'order_placed': return 'bg-purple-100 text-purple-800'
      case 'delivery_completed': return 'bg-orange-100 text-orange-800'
      case 'product_viewed': return 'bg-gray-100 text-gray-800'
      case 'job_accepted': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-4">
        <div className="space-y-4">
          <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"></div>
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
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-gray-600">Complete business analytics and insights</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/admin/analytics">
            <Button variant="outline">
              <BarChart3 className="h-4 w-4 mr-2" />
              Detailed Analytics
            </Button>
          </Link>
          <Link href="/admin/sponsored">
            <Button variant="outline">
              <TrendingUp className="h-4 w-4 mr-2" />
              Sponsored Listings
            </Button>
          </Link>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Users</p>
                <p className="text-2xl font-bold">{userStats.totalUsers}</p>
                <p className="text-sm text-green-600">+{userStats.newUsersThisWeek} this week</p>
              </div>
              <Users className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Revenue</p>
                <p className="text-2xl font-bold">${businessStats.totalRevenue.toFixed(2)}</p>
                <p className="text-sm text-gray-600">{businessStats.totalOrders} orders</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Order Value</p>
                <p className="text-2xl font-bold">${businessStats.averageOrderValue.toFixed(2)}</p>
                <p className="text-sm text-gray-600">{businessStats.pendingOrders} pending</p>
              </div>
              <ShoppingCart className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Deliveries</p>
                <p className="text-2xl font-bold">{businessStats.completedDeliveries}</p>
                <p className="text-sm text-gray-600">Completed</p>
              </div>
              <Truck className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Users className="h-8 w-8 mx-auto mb-2 text-blue-600" />
            <p className="text-lg font-bold">{userStats.customers}</p>
            <p className="text-sm text-gray-600">Customers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Store className="h-8 w-8 mx-auto mb-2 text-green-600" />
            <p className="text-lg font-bold">{userStats.vendors}</p>
            <p className="text-sm text-gray-600">Vendors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Truck className="h-8 w-8 mx-auto mb-2 text-orange-600" />
            <p className="text-lg font-bold">{userStats.drivers}</p>
            <p className="text-sm text-gray-600">Drivers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 text-purple-600" />
            <p className="text-lg font-bold">{userStats.newUsersThisWeek}</p>
            <p className="text-sm text-gray-600">New This Week</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts and Analytics */}
      <Tabs defaultValue="activity" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="activity">Activity Trends</TabsTrigger>
          <TabsTrigger value="events">Event Breakdown</TabsTrigger>
          <TabsTrigger value="recent">Recent Activity</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        {/* Activity Trends */}
        <TabsContent value="activity" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>7-Day Activity Trends</CardTitle>
              <CardDescription>Daily user activity and business metrics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="logins" stroke="#3B82F6" strokeWidth={2} />
                    <Line type="monotone" dataKey="orders" stroke="#10B981" strokeWidth={2} />
                    <Line type="monotone" dataKey="deliveries" stroke="#F59E0B" strokeWidth={2} />
                    <Line type="monotone" dataKey="signups" stroke="#EF4444" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Event Breakdown */}
        <TabsContent value="events" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Event Types Distribution</CardTitle>
                <CardDescription>Most common user actions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={eventTypeBreakdown}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }: { name?: string; percent?: number }) => 
                          `${name || 'Unknown'} ${percent ? (percent * 100).toFixed(0) : 0}%`
                        }
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {eventTypeBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Event Counts</CardTitle>
                <CardDescription>Total events by type</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={eventTypeBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#3B82F6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Recent Activity */}
        <TabsContent value="recent" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Analytics Events</CardTitle>
              <CardDescription>Latest user interactions and system events</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-96 overflow-y-auto space-y-3">
                {recentEvents.map((event) => (
                  <div key={event.id} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="p-2 rounded-md bg-gray-100">
                      {getEventIcon(event.event_type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge className={getEventColor(event.event_type)}>
                          {event.event_type.replace('_', ' ')}
                        </Badge>
                        <span className="text-sm text-gray-600">
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        User: {event.user_id.slice(-8)}
                        {event.data && Object.keys(event.data).length > 0 && (
                          <span className="ml-2">
                            • {JSON.stringify(event.data).slice(0, 50)}...
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              
              {recentEvents.length === 0 && (
                <div className="text-center py-8">
                  <Activity className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No recent events</h3>
                  <p className="text-gray-600">Analytics events will appear here as users interact with the platform</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Insights */}
        <TabsContent value="insights" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Growth Insights</CardTitle>
                <CardDescription>AI-powered business insights (Demo)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                    <span className="font-semibold text-green-800">Positive Trend</span>
                  </div>
                  <p className="text-sm text-green-700">
                    User signups increased by {userStats.newUsersThisWeek > 0 ? '15%' : '0%'} this week. 
                    Customer engagement is trending upward with more frequent orders.
                  </p>
                </div>
                
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-5 w-5 text-blue-600" />
                    <span className="font-semibold text-blue-800">User Distribution</span>
                  </div>
                  <p className="text-sm text-blue-700">
                    {((userStats.customers / userStats.totalUsers) * 100).toFixed(1)}% customers, 
                    {((userStats.vendors / userStats.totalUsers) * 100).toFixed(1)}% vendors, 
                    {((userStats.drivers / userStats.totalUsers) * 100).toFixed(1)}% drivers. 
                    Healthy marketplace balance.
                  </p>
                </div>

                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                    <span className="font-semibold text-yellow-800">Opportunity</span>
                  </div>
                  <p className="text-sm text-yellow-700">
                    Average order value is ${businessStats.averageOrderValue.toFixed(2)}. 
                    Consider implementing upselling strategies to increase basket size.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance Summary</CardTitle>
                <CardDescription>Weekly platform performance</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Order Completion Rate</span>
                    <span className="text-sm text-green-600 font-semibold">
                      {businessStats.totalOrders > 0 ? 
                        ((businessStats.completedDeliveries / businessStats.totalOrders) * 100).toFixed(1) : 0
                      }%
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Platform Revenue</span>
                    <span className="text-sm font-semibold">
                      ${(businessStats.totalRevenue * 0.05).toFixed(2)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Active Vendors</span>
                    <span className="text-sm font-semibold">{userStats.vendors}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Active Drivers</span>
                    <span className="text-sm font-semibold">{userStats.drivers}</span>
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-sm text-gray-600">
                      💡 <strong>AI Recommendation:</strong> Focus on driver acquisition 
                      to improve delivery times and customer satisfaction.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}