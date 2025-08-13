import { createServerSupabase } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DriverDashboard() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
          <h2 className="text-lg font-semibold text-yellow-800">Login Required</h2>
          <p className="text-yellow-700">Please log in to access the driver dashboard.</p>
        </div>
      </div>
    )
  }

  // Get driver profile and verify role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, name, kyc_status, location, rating')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'driver') {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <h2 className="text-lg font-semibold text-red-800">Access Denied</h2>
          <p className="text-red-700">This dashboard is only accessible to drivers.</p>
        </div>
      </div>
    )
  }

  // Get driver statistics
  const { data: activeJobs } = await supabase
    .from('delivery_jobs')
    .select('id, status, created_at, current_eta')
    .eq('driver_id', user.id)
    .in('status', ['assigned', 'in_transit'])

  const { data: completedJobs } = await supabase
    .from('delivery_jobs')
    .select('id')
    .eq('driver_id', user.id)
    .eq('status', 'completed')

  const { data: availableJobs } = await supabase
    .from('delivery_jobs')
    .select('id, pickup_location, dropoff_location, eta')
    .eq('status', 'open')
    .limit(5)

  const { data: earnings } = await supabase
    .from('payments')
    .select('driver_payout')
    .not('driver_payout', 'is', null)

  const totalEarnings = earnings?.reduce((sum, payment) => sum + (payment.driver_payout || 0), 0) || 0

  // Get recent analytics
  const { data: recentActivity } = await supabase
    .from('analytics_events')
    .select('event_type, created_at, data')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Driver Dashboard</h1>
          <p className="text-gray-600">Welcome back, {profile.name || 'Driver'}!</p>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`rounded-full px-3 py-1 text-sm font-medium ${
            profile.kyc_status === 'verified' 
              ? 'bg-green-100 text-green-800' 
              : profile.kyc_status === 'pending'
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-red-100 text-red-800'
          }`}>
            KYC: {profile.kyc_status}
          </div>
          <div className="text-sm text-gray-500">
            Rating: ⭐ {profile.rating?.toFixed(1) || 'N/A'}
          </div>
        </div>
      </div>

      {/* KYC Alert */}
      {profile.kyc_status !== 'verified' && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-orange-800">Complete Your Verification</h3>
              <p className="text-orange-700">Upload required documents to start accepting delivery jobs.</p>
            </div>
            <Link 
              href="/driver/kyc" 
              className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
            >
              Complete KYC
            </Link>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-white border p-4 shadow-sm">
          <div className="text-2xl font-bold text-blue-600">{activeJobs?.length || 0}</div>
          <div className="text-sm text-gray-600">Active Jobs</div>
        </div>
        <div className="rounded-lg bg-white border p-4 shadow-sm">
          <div className="text-2xl font-bold text-green-600">{completedJobs?.length || 0}</div>
          <div className="text-sm text-gray-600">Completed Jobs</div>
        </div>
        <div className="rounded-lg bg-white border p-4 shadow-sm">
          <div className="text-2xl font-bold text-purple-600">${totalEarnings.toFixed(2)}</div>
          <div className="text-sm text-gray-600">Total Earnings</div>
        </div>
        <div className="rounded-lg bg-white border p-4 shadow-sm">
          <div className="text-2xl font-bold text-orange-600">{availableJobs?.length || 0}</div>
          <div className="text-sm text-gray-600">Available Jobs</div>
        </div>
      </div>

      {/* Active Jobs */}
      {activeJobs && activeJobs.length > 0 && (
        <div className="rounded-lg bg-white border p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Active Deliveries</h2>
          <div className="space-y-3">
            {activeJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between border-l-4 border-blue-500 bg-blue-50 p-3">
                <div>
                  <div className="font-medium">Job #{job.id.slice(0, 8)}</div>
                  <div className="text-sm text-gray-600">Status: {job.status}</div>
                  {job.current_eta && (
                    <div className="text-sm text-blue-600">ETA: {job.current_eta}</div>
                  )}
                </div>
                <Link 
                  href={`/driver/jobs/${job.id}`}
                  className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                >
                  View Details
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Jobs */}
      <div className="rounded-lg bg-white border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Available Jobs Nearby</h2>
          <Link 
            href="/driver/jobs" 
            className="text-blue-600 hover:text-blue-700"
          >
            View All →
          </Link>
        </div>
        {availableJobs && availableJobs.length > 0 ? (
          <div className="space-y-3">
            {availableJobs.map((job) => (
              <div key={job.id} className="border rounded-lg p-3 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Job #{job.id.slice(0, 8)}</div>
                    <div className="text-sm text-gray-600">
                      Pickup: {job.pickup_location?.address || 'Location provided'}
                    </div>
                    <div className="text-sm text-gray-600">
                      Dropoff: {job.dropoff_location?.address || 'Location provided'}
                    </div>
                    {job.eta && (
                      <div className="text-sm text-green-600">Estimated: {job.eta}</div>
                    )}
                  </div>
                  <button className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700">
                    Accept Job
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">🚚</div>
            <div>No jobs available in your area</div>
            <div className="text-sm">Check back later or expand your delivery radius</div>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg bg-white border p-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
        {recentActivity && recentActivity.length > 0 ? (
          <div className="space-y-2">
            {recentActivity.map((activity, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{activity.event_type.replace('_', ' ')}</span>
                  {activity.data && (
                    <span className="text-gray-600 ml-2">
                      {JSON.stringify(activity.data).slice(0, 50)}...
                    </span>
                  )}
                </div>
                <div className="text-gray-500">
                  {new Date(activity.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-center py-4">
            No recent activity
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Link 
          href="/driver/location"
          className="rounded-lg bg-blue-600 p-4 text-center text-white hover:bg-blue-700"
        >
          <div className="text-lg font-semibold">📍 Update Location</div>
          <div className="text-sm opacity-90">Share your current location</div>
        </Link>
        <Link 
          href="/driver/earnings"
          className="rounded-lg bg-green-600 p-4 text-center text-white hover:bg-green-700"
        >
          <div className="text-lg font-semibold">💰 View Earnings</div>
          <div className="text-sm opacity-90">Check payouts and history</div>
        </Link>
        <Link 
          href="/driver/support"
          className="rounded-lg bg-purple-600 p-4 text-center text-white hover:bg-purple-700"
        >
          <div className="text-lg font-semibold">🆘 Get Support</div>
          <div className="text-sm opacity-90">Contact customer service</div>
        </Link>
      </div>
    </div>
  )
}