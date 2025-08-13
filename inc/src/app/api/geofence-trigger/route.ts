import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const schema = z.object({
  jobId: z.string().uuid(),
  triggerType: z.enum(['arriving', 'departed']),
  location: z.object({
    lat: z.number(),
    lng: z.number()
  }),
  radiusMeters: z.number().min(50).max(1000).default(100)
})

const triggerSchema = z.object({
  location: z.object({
    lat: z.number(),
    lng: z.number()
  })
})

// POST - Create geofence for a delivery job
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error }, { status: 400 })
    }

    const { jobId, triggerType, location, radiusMeters } = parsed.data

    // Verify user has access to this job (driver, vendor, or admin)
    const { data: job } = await supabase
      .from('delivery_jobs')
      .select(`
        id,
        driver_id,
        order_id,
        orders!inner(vendor_id)
      `)
      .eq('id', jobId)
      .single()

    if (!job) {
      return NextResponse.json({ error: 'job_not_found' }, { status: 404 })
    }

    // Check authorization
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isAuthorized = profile?.role === 'admin' || 
                        job.driver_id === user.id || 
                        job.orders.vendor_id === user.id

    if (!isAuthorized) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
    }

    // Create geofence
    const { data: geofence, error: geofenceError } = await supabase
      .from('geofences')
      .insert({
        job_id: jobId,
        center_point: `POINT(${location.lng} ${location.lat})`,
        radius_m: radiusMeters,
        trigger_type: triggerType,
        notified: false
      })
      .select()
      .single()

    if (geofenceError) {
      return NextResponse.json({ error: 'geofence_creation_failed', details: geofenceError }, { status: 500 })
    }

    // Log analytics event
    await supabase
      .from('analytics_events')
      .insert({
        user_id: user.id,
        event_type: 'geofence_created',
        data: {
          geofence_id: geofence.id,
          job_id: jobId,
          trigger_type: triggerType,
          radius_meters: radiusMeters,
          location
        }
      })

    return NextResponse.json({
      success: true,
      geofence_id: geofence.id,
      job_id: jobId,
      trigger_type: triggerType,
      radius_meters: radiusMeters,
      status: 'active'
    })

  } catch (error) {
    console.error('Geofence creation error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

// PUT - Trigger geofence (check if location is within any active geofences)
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = triggerSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error }, { status: 400 })
    }

    const { location } = parsed.data

    // Get driver's active jobs
    const { data: activeJobs } = await supabase
      .from('delivery_jobs')
      .select('id')
      .eq('driver_id', user.id)
      .in('status', ['assigned', 'in_transit'])

    if (!activeJobs || activeJobs.length === 0) {
      return NextResponse.json({ triggered_geofences: [] })
    }

    const jobIds = activeJobs.map(job => job.id)

    // Find geofences that haven't been triggered yet
    const { data: activeGeofences } = await supabase
      .from('geofences')
      .select('*')
      .in('job_id', jobIds)
      .eq('notified', false)

    if (!activeGeofences || activeGeofences.length === 0) {
      return NextResponse.json({ triggered_geofences: [] })
    }

    const triggeredGeofences = []

    // Check each geofence for trigger conditions
    for (const geofence of activeGeofences) {
      try {
        // Use PostGIS to check if point is within geofence radius
        // Note: This is a simplified check - in production you'd use proper PostGIS functions
        const { data: isWithin } = await supabase
          .rpc('point_within_radius', {
            check_point: `POINT(${location.lng} ${location.lat})`,
            center_point: geofence.center_point,
            radius_meters: geofence.radius_m
          })
          .single()

        if (isWithin) {
          // Mark geofence as triggered
          await supabase
            .from('geofences')
            .update({ notified: true })
            .eq('id', geofence.id)

          triggeredGeofences.push({
            geofence_id: geofence.id,
            job_id: geofence.job_id,
            trigger_type: geofence.trigger_type,
            triggered_at: new Date().toISOString()
          })

          // Log analytics event
          await supabase
            .from('analytics_events')
            .insert({
              user_id: user.id,
              event_type: 'geofence_triggered',
              data: {
                geofence_id: geofence.id,
                job_id: geofence.job_id,
                trigger_type: geofence.trigger_type,
                driver_location: location,
                triggered_at: new Date().toISOString()
              }
            })

          // In production, this would trigger real-time notifications
          // via Supabase Realtime, Pusher, or push notifications
          console.log(`Geofence triggered: ${geofence.trigger_type} for job ${geofence.job_id}`)
        }

      } catch (geoError) {
        console.error(`Error checking geofence ${geofence.id}:`, geoError)
        // Continue checking other geofences
      }
    }

    return NextResponse.json({
      triggered_geofences: triggeredGeofences,
      location_checked: location,
      total_active_geofences: activeGeofences.length
    })

  } catch (error) {
    console.error('Geofence trigger check error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

// GET - List active geofences for user
export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    let geofences
    if (profile?.role === 'admin') {
      // Admins can see all geofences
      const { data } = await supabase
        .from('geofences')
        .select(`
          *,
          delivery_jobs!inner(
            id,
            order_id,
            driver_id,
            status
          )
        `)
        .order('created_at', { ascending: false })
      geofences = data
    } else if (profile?.role === 'driver') {
      // Drivers see geofences for their jobs
      const { data } = await supabase
        .from('geofences')
        .select(`
          *,
          delivery_jobs!inner(
            id,
            order_id,
            driver_id,
            status
          )
        `)
        .eq('delivery_jobs.driver_id', user.id)
        .order('created_at', { ascending: false })
      geofences = data
    } else if (profile?.role === 'vendor') {
      // Vendors see geofences for their orders
      const { data } = await supabase
        .from('geofences')
        .select(`
          *,
          delivery_jobs!inner(
            id,
            order_id,
            orders!inner(vendor_id)
          )
        `)
        .eq('delivery_jobs.orders.vendor_id', user.id)
        .order('created_at', { ascending: false })
      geofences = data
    } else {
      geofences = []
    }

    return NextResponse.json({
      geofences: geofences || [],
      total_count: geofences?.length || 0
    })

  } catch (error) {
    console.error('Geofence list error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}