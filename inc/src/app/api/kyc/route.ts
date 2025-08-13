import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

const verificationSchema = z.object({
  document_type: z.enum(['drivers_license', 'insurance', 'vehicle_registration', 'identity_photo']),
  return_url: z.string().url().optional()
})

const statusSchema = z.object({
  verification_session_id: z.string()
})

// POST - Start KYC verification process
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
      .select('role, email, name, kyc_status')
      .eq('id', user.id)
      .single()
    
    if (!profile || profile.role !== 'driver') {
      return NextResponse.json({ error: 'drivers_only' }, { status: 403 })
    }

    if (profile.kyc_status === 'verified') {
      return NextResponse.json({ error: 'already_verified' }, { status: 400 })
    }

    const body = await req.json()
    const parsed = verificationSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error }, { status: 400 })
    }

    const { document_type, return_url } = parsed.data
    const stripe = getStripe()

    try {
      // Create Stripe Identity verification session
      const verificationSession = await stripe.identity.verificationSessions.create({
        type: 'document',
        metadata: {
          user_id: user.id,
          document_type,
          role: 'driver'
        },
        options: {
          document: {
            require_matching_selfie: document_type === 'drivers_license',
            require_id_number: document_type === 'drivers_license',
            require_live_capture: true,
            allowed_types: ['driving_license', 'passport', 'id_card']
          }
        },
        ...(return_url && { return_url })
      })

      // Store KYC document record
      const { data: kycDoc, error: kycError } = await supabase
        .from('kyc_docs')
        .insert({
          driver_id: user.id,
          doc_type: document_type,
          stripe_verification_session_id: verificationSession.id,
          status: 'pending'
        })
        .select()
        .single()

      if (kycError) {
        return NextResponse.json({ error: 'kyc_record_failed', details: kycError }, { status: 500 })
      }

      // Update profile KYC status to pending
      await supabase
        .from('profiles')
        .update({ kyc_status: 'pending' })
        .eq('id', user.id)

      // Log analytics event
      await supabase
        .from('analytics_events')
        .insert({
          user_id: user.id,
          event_type: 'kyc_started',
          data: {
            document_type,
            verification_session_id: verificationSession.id,
            kyc_doc_id: kycDoc.id
          }
        })

      return NextResponse.json({
        success: true,
        verification_session_id: verificationSession.id,
        verification_url: verificationSession.url,
        kyc_doc_id: kycDoc.id,
        status: 'pending',
        expires_at: verificationSession.expires_at
      })

    } catch (stripeError: unknown) {
      console.error('Stripe verification session creation failed:', stripeError)
      const errorMessage = stripeError instanceof Error ? stripeError.message : 'Unknown error'
      return NextResponse.json({ 
        error: 'verification_setup_failed', 
        details: errorMessage 
      }, { status: 500 })
    }

  } catch (error) {
    console.error('KYC verification error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

// GET - Check KYC status
export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, kyc_status')
      .eq('id', user.id)
      .single()
    
    if (!profile || profile.role !== 'driver') {
      return NextResponse.json({ error: 'drivers_only' }, { status: 403 })
    }

    // Get KYC documents
    const { data: kycDocs } = await supabase
      .from('kyc_docs')
      .select('*')
      .eq('driver_id', user.id)
      .order('created_at', { ascending: false })

    // Check if all required documents are verified
    const requiredDocs = ['drivers_license', 'insurance', 'vehicle_registration']
    const verifiedDocs = kycDocs?.filter(doc => doc.status === 'verified').map(doc => doc.doc_type) || []
    
    const isFullyVerified = requiredDocs.every(docType => verifiedDocs.includes(docType))
    const missingDocs = requiredDocs.filter(docType => !verifiedDocs.includes(docType))

    return NextResponse.json({
      kyc_status: profile.kyc_status,
      is_fully_verified: isFullyVerified,
      documents: kycDocs || [],
      verified_documents: verifiedDocs,
      missing_documents: missingDocs,
      can_drive: isFullyVerified && profile.kyc_status === 'verified'
    })

  } catch (error) {
    console.error('KYC status check error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

// PUT - Update KYC status (webhook handler)
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = statusSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error }, { status: 400 })
    }

    const { verification_session_id } = parsed.data
    const stripe = getStripe()

    // Retrieve verification session from Stripe
    const verificationSession = await stripe.identity.verificationSessions.retrieve(verification_session_id)
    
    const supabase = await createServerSupabase()
    
    // Find KYC document record
    const { data: kycDoc } = await supabase
      .from('kyc_docs')
      .select('*')
      .eq('stripe_verification_session_id', verification_session_id)
      .single()

    if (!kycDoc) {
      return NextResponse.json({ error: 'kyc_record_not_found' }, { status: 404 })
    }

    // Map Stripe status to our status
    let kycStatus: 'pending' | 'verified' | 'rejected' = 'pending'
    if (verificationSession.status === 'verified') {
      kycStatus = 'verified'
    } else if (verificationSession.status === 'requires_input' || verificationSession.status === 'canceled') {
      kycStatus = 'rejected'
    }

    // Update KYC document status
    await supabase
      .from('kyc_docs')
      .update({ status: kycStatus })
      .eq('id', kycDoc.id)

    // Check if driver is now fully verified
    const { data: allKycDocs } = await supabase
      .from('kyc_docs')
      .select('doc_type, status')
      .eq('driver_id', kycDoc.driver_id)

    const requiredDocs = ['drivers_license', 'insurance', 'vehicle_registration']
    const verifiedDocs = allKycDocs?.filter(doc => doc.status === 'verified').map(doc => doc.doc_type) || []
    const isFullyVerified = requiredDocs.every(docType => verifiedDocs.includes(docType))

    // Update profile KYC status
    const profileKycStatus = isFullyVerified ? 'verified' : 
      (allKycDocs?.some(doc => doc.status === 'rejected') ? 'rejected' : 'pending')

    await supabase
      .from('profiles')
      .update({ kyc_status: profileKycStatus })
      .eq('id', kycDoc.driver_id)

    // Log analytics event
    await supabase
      .from('analytics_events')
      .insert({
        user_id: kycDoc.driver_id,
        event_type: 'kyc_updated',
        data: {
          document_type: kycDoc.doc_type,
          new_status: kycStatus,
          profile_kyc_status: profileKycStatus,
          is_fully_verified: isFullyVerified,
          verification_session_id
        }
      })

    return NextResponse.json({
      success: true,
      document_status: kycStatus,
      profile_kyc_status: profileKycStatus,
      is_fully_verified: isFullyVerified
    })

  } catch (error) {
    console.error('KYC status update error:', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}