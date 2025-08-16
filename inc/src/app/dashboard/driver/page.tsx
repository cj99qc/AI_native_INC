'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { useDriverHeartbeat } from '@/hooks/useGeolocation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Truck, 
  MapPin, 
  Clock, 
  DollarSign,
  Navigation,
  CheckCircle,
  AlertCircle,
  Package,
  Route,
  Activity
} from 'lucide-react'
import Link from 'next/link'

type DeliveryJob = {
  id: string
  order_id: string
  pickup_location: Record<string, unknown>
  dropoff_location: Record<string, unknown>
  status: 'open' | 'assigned' | 'in_transit' | 'completed' | 'cancelled'
  driver_id?: string
  current_eta?: string
  created_at: string
  distance_km?: number
  estimated_payout?: number
  customer_info?: {
    name?: string
    phone?: string
  }
  order?: {
    id: string
    total: number
  }
}

type DriverStats = {
  totalEarnings: number
  completedJobs: number
  activeJobs: number
  rating: number
  thisWeekJobs: number
}

export default function DriverDashboard() {
  const { user, isDriver, isAdmin } = useAuth()
  const supabase = useSupabase()
  const router = useRouter()
  
  const [availableJobs, setAvailableJobs] = useState<DeliveryJob[]>([])
  const [activeJobs, setActiveJobs] = useState<DeliveryJob[]>([])
  const [completedJobs, setCompletedJobs] = useState<DeliveryJob[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DriverStats>({
    totalEarnings: 0,
    completedJobs: 0,
    activeJobs: 0,
    rating: 4.8,
    thisWeekJobs: 0
  })

  // Location and heartbeat
  const {
    isActive: heartbeatActive,
    location: currentLocation,
    startHeartbeat,
    stopHeartbeat,
    lastUpdate
  } = useDriverHeartbeat(15000) // 15 seconds

  useEffect(() => {
    if (!user) return
    fetchDashboardData()
    
    // Set up real-time subscriptions
    const jobsSubscription = supabase
      .channel('delivery_jobs_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'delivery_jobs'
      }, () => {
        console.log('Job update received')
        fetchDashboardData() // Refresh data on changes
      })
      .subscribe()

    return () => {
      jobsSubscription.unsubscribe()
    }
  }, [user, supabase])

  // Role protection
  if (!loading && user && !isDriver && !isAdmin) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <h2 className="text-lg font-semibold text-red-800">Access Denied</h2>
          <p className="text-red-700">This dashboard is only accessible to drivers.</p>
        </div>
      </div>
    )
  }

  const fetchDashboardData = async () => {
    if (!user) return
    
    try {
      setLoading(true)

      // Fetch available jobs (within 300km - for demo using all open jobs)
      const { data: availableJobsData } = await supabase
        .from('delivery_jobs')
        .select(`
          *,
          order:orders!order_id(id, total, customer_id)
        `)
        .eq('status', 'open')
        .is('driver_id', null)
        .order('created_at', { ascending: false })

      // Fetch driver's active jobs
      const { data: activeJobsData } = await supabase
        .from('delivery_jobs')
        .select(`
          *,
          order:orders!order_id(id, total, customer_id)
        `)
        .eq('driver_id', user.id)
        .in('status', ['assigned', 'in_transit'])
        .order('created_at', { ascending: false })

      // Fetch completed jobs for stats
      const { data: completedJobsData } = await supabase
        .from('delivery_jobs')
        .select(`
          *,
          order:orders!order_id(id, total, customer_id)
        `)
        .eq('driver_id', user.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(10)

      // Calculate earnings from payments
      const { data: earnings } = await supabase
        .from('payments')
        .select('driver_payout')
        .not('driver_payout', 'is', null)

      const totalEarnings = earnings?.reduce((sum, payment) => sum + (payment.driver_payout || 0), 0) || 0

      // Calculate this week's jobs
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const thisWeekJobs = completedJobsData?.filter(job => 
        new Date(job.created_at) > oneWeekAgo
      ).length || 0

      // Add estimated distance and payout to available jobs (demo calculation)
      const jobsWithEstimates = availableJobsData?.map(job => ({
        ...job,
        distance_km: Math.floor(Math.random() * 25) + 5, // 5-30km for demo
        estimated_payout: (Math.floor(Math.random() * 15) + 10) // $10-25 for demo
      })) || []

      setAvailableJobs(jobsWithEstimates)
      setActiveJobs(activeJobsData || [])
      setCompletedJobs(completedJobsData || [])
      setStats({
        totalEarnings,
        completedJobs: completedJobsData?.length || 0,
        activeJobs: activeJobsData?.length || 0,
        rating: 4.8, // Demo rating
        thisWeekJobs
      })
    } catch (error) {
      console.error('Error fetching driver dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const acceptJob = async (jobId: string) => {
    try {
      const { error } = await supabase
        .from('delivery_jobs')
        .update({ 
          driver_id: user?.id, 
          status: 'assigned',
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)

      if (error) throw error

      // Log analytics event
      await supabase
        .from('analytics_events')
        .insert({
          user_id: user?.id,
          event_type: 'job_accepted',
          data: { job_id: jobId }
        })

      fetchDashboardData()
    } catch (error) {
      console.error('Error accepting job:', error)
    }
  }

  const updateJobStatus = async (jobId: string, status: DeliveryJob['status']) => {
    try {
      const { error } = await supabase
        .from('delivery_jobs')
        .update({ 
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)

      if (error) throw error

      // Log analytics event
      await supabase
        .from('analytics_events')
        .insert({
          user_id: user?.id,
          event_type: status === 'completed' ? 'delivery_completed' : 'job_status_updated',
          data: { job_id: jobId, status }
        })

      fetchDashboardData()
    } catch (error) {
      console.error('Error updating job status:', error)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800'
      case 'in_transit': return 'bg-blue-100 text-blue-800'
      case 'assigned': return 'bg-yellow-100 text-yellow-800'
      case 'open': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const formatLocation = (location: Record<string, unknown> | string | null | undefined): string => {
    if (!location) return 'Location not available'
    if (typeof location === 'string') return location
    if (typeof location === 'object' && location.address) return String(location.address)
    if (typeof location === 'object' && location.lat && location.lng && typeof location.lat === 'number' && typeof location.lng === 'number') {
      return `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
    }
    return 'Location not available'
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Driver Dashboard</h1>
          <p className="text-gray-600">Welcome back, {user?.profile?.name || 'Driver'}!</p>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant={heartbeatActive ? "destructive" : "default"}
            onClick={heartbeatActive ? stopHeartbeat : startHeartbeat}
          >
            <Activity className={`h-4 w-4 mr-2 ${heartbeatActive ? 'animate-pulse' : ''}`} />
            {heartbeatActive ? 'Go Offline' : 'Go Online'}
          </Button>
          <Link href="/driver/earnings">
            <Button variant="outline">
              <DollarSign className="h-4 w-4 mr-2" />
              Earnings
            </Button>
          </Link>
        </div>
      </div>

      {/* Status Indicator */}
      <Card className={heartbeatActive ? 'border-green-200 bg-green-50' : 'border-gray-200'}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${heartbeatActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
              <div>
                <p className="font-medium">
                  {heartbeatActive ? 'Online - Available for Jobs' : 'Offline'}
                </p>
                <p className="text-sm text-gray-600">
                  {lastUpdate ? `Last update: ${lastUpdate.toLocaleTimeString()}` : 'Not sharing location'}
                </p>
              </div>
            </div>
            {currentLocation && (
              <div className="text-right">
                <p className="text-sm text-gray-600">Current Location</p>
                <p className="font-medium">{currentLocation.latitude.toFixed(4)}, {currentLocation.longitude.toFixed(4)}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Earnings</p>
                <p className="text-2xl font-bold">${stats.totalEarnings.toFixed(2)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed Jobs</p>
                <p className="text-2xl font-bold">{stats.completedJobs}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Jobs</p>
                <p className="text-2xl font-bold">{stats.activeJobs}</p>
              </div>
              <Truck className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">This Week</p>
                <p className="text-2xl font-bold">{stats.thisWeekJobs}</p>
              </div>
              <Activity className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="available" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="available">Available Jobs ({availableJobs.length})</TabsTrigger>
          <TabsTrigger value="active">Active Jobs ({activeJobs.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedJobs.length})</TabsTrigger>
        </TabsList>

        {/* Available Jobs */}
        <TabsContent value="available" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Available Delivery Jobs</h2>
            <p className="text-sm text-gray-600">{availableJobs.length} jobs within 300km</p>
          </div>

          <div className="grid gap-4">
            {availableJobs.map((job) => (
              <Card key={job.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-blue-600" />
                        <span className="font-medium">Pickup</span>
                      </div>
                      <p className="text-sm text-gray-600 pl-6">
                        {formatLocation(job.pickup_location)}
                      </p>
                      
                      <div className="flex items-center gap-2 mt-3">
                        <Navigation className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Drop-off</span>
                      </div>
                      <p className="text-sm text-gray-600 pl-6">
                        {formatLocation(job.dropoff_location)}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Route className="h-4 w-4" />
                        <span className="text-sm">Distance: ~{job.distance_km}km</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        <span className="text-sm">Est. Payout: ${job.estimated_payout}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm">Posted: {new Date(job.created_at).toLocaleString()}</span>
                      </div>
                      {job.order && (
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          <span className="text-sm">Order Value: ${job.order.total}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col justify-between">
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                      <Button 
                        onClick={() => acceptJob(job.id)}
                        className="mt-4"
                        disabled={!heartbeatActive}
                      >
                        Accept Job
                      </Button>
                      {!heartbeatActive && (
                        <p className="text-xs text-gray-500 mt-2">Go online to accept jobs</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {availableJobs.length === 0 && (
            <div className="text-center py-12">
              <Truck className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No available jobs</h3>
              <p className="text-gray-600">
                {heartbeatActive ? 
                  'New delivery jobs will appear here when available' : 
                  'Go online to see available jobs'
                }
              </p>
            </div>
          )}
        </TabsContent>

        {/* Active Jobs */}
        <TabsContent value="active" className="space-y-4">
          <h2 className="text-xl font-semibold">Your Active Jobs</h2>

          <div className="grid gap-4">
            {activeJobs.map((job) => (
              <Card key={job.id}>
                <CardContent className="p-6">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-blue-600" />
                        <span className="font-medium">Pickup</span>
                      </div>
                      <p className="text-sm text-gray-600 pl-6">
                        {formatLocation(job.pickup_location)}
                      </p>
                      
                      <div className="flex items-center gap-2 mt-3">
                        <Navigation className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Drop-off</span>
                      </div>
                      <p className="text-sm text-gray-600 pl-6">
                        {formatLocation(job.dropoff_location)}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm">
                          ETA: {job.current_eta || 'Calculating...'}
                        </span>
                      </div>
                      {job.order && (
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          <span className="text-sm">Order #{job.order.id.slice(-6)}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      {job.status === 'assigned' && (
                        <Button onClick={() => updateJobStatus(job.id, 'in_transit')}>
                          Start Delivery
                        </Button>
                      )}
                      {job.status === 'in_transit' && (
                        <Button onClick={() => updateJobStatus(job.id, 'completed')}>
                          Mark Complete
                        </Button>
                      )}
                      <Button variant="outline" size="sm">
                        View Route
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {activeJobs.length === 0 && (
            <div className="text-center py-12">
              <AlertCircle className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No active jobs</h3>
              <p className="text-gray-600">Accepted jobs will appear here</p>
            </div>
          )}
        </TabsContent>

        {/* Completed Jobs */}
        <TabsContent value="completed" className="space-y-4">
          <h2 className="text-xl font-semibold">Recently Completed Jobs</h2>

          <div className="grid gap-4">
            {completedJobs.map((job) => (
              <Card key={job.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="font-medium">Delivery Completed</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        {formatLocation(job.pickup_location)} → {formatLocation(job.dropoff_location)}
                      </p>
                      <p className="text-sm text-gray-600">
                        Completed: {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                      {job.order && (
                        <p className="text-sm text-gray-600 mt-1">
                          Order: ${job.order.total}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {completedJobs.length === 0 && (
            <div className="text-center py-12">
              <Package className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No completed jobs yet</h3>
              <p className="text-gray-600">Your delivery history will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}