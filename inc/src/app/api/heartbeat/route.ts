import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

const schema = z.object({
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().optional()
  }),
  isActive: z.boolean().default(true)
})

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    // Verify user is a driver
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (!profile || profile.role !== 'driver') {
      return NextResponse.json({ error: 'drivers_only' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error }, { status: 400 })
    }

    const { location, isActive } = parsed.data

    // Update driver location and geo_point
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        location,
        geo_point: `POINT(${location.lng} ${location.lat})`
      })
      .eq('id', user.id)

    if (updateError) {
      return NextResponse.json({ error: 'update_failed', details: updateError }, { status: 500 })
    }

    if (isActive) {
      // Get active jobs assigned to this driver
      const { data: activeJobs } = await supabase
        .from('delivery_jobs')
        .select(`
          id,
          order_id,
          pickup_location,
          dropoff_location,
          pickup_geo,
          dropoff_geo,
          eta,
          current_eta,
          status
        `)
        .eq('driver_id', user.id)
        .in('status', ['assigned', 'in_transit'])

      if (activeJobs && activeJobs.length > 0) {
        // Recalculate ETAs for active jobs using AI/heuristics
        const openai = getOpenAI()
        
        for (const job of activeJobs) {
          try {
            // Update ETA with AI-enhanced prediction
            const aiPrompt = `
              Given current driver location: ${JSON.stringify(location)}
              Job pickup: ${JSON.stringify(job.pickup_location)}
              Job dropoff: ${JSON.stringify(job.dropoff_location)}
              Current status: ${job.status}
              
              Estimate realistic ETA in minutes considering traffic, distance, and delivery complexity.
              Return only a number (minutes).
            `

            const completion = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [{ role: 'user', content: aiPrompt }],
              max_tokens: 50
            })

            const aiEtaMinutes = parseInt(completion.choices[0]?.message?.content?.trim() || '30')

            // Update job with new ETA
            await supabase
              .from('delivery_jobs')
              .update({ 
                current_eta: `${aiEtaMinutes} minutes`
              })
              .eq('id', job.id)

          } catch (aiError) {
            console.error('AI ETA calculation failed:', aiError)
            // Fallback to simple calculation
            await supabase
              .from('delivery_jobs')
              .update({ 
                current_eta: '30 minutes' // Fallback
              })
              .eq('id', job.id)
          }
        }

        // Check for geofence triggers (simplified - would use PostGIS in production)
        const { data: geofences } = await supabase
          .from('geofences')
          .select('*')
          .in('job_id', activeJobs.map(j => j.id))
          .eq('notified', false)

        // Note: Full geofence checking would require PostGIS ST_DWithin
        // For now, this is a placeholder for the geofence logic
        if (geofences && geofences.length > 0) {
          console.log(`Found ${geofences.length} active geofences to check`)
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Location updated successfully',
      location,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Heartbeat error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}