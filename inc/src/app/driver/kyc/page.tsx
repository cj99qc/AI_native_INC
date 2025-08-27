'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Shield, 
  FileText,
  CheckCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  Truck,
  Car,
  FileCheck
} from 'lucide-react'
import Link from 'next/link'

type KycDocument = {
  id: string
  doc_type: string
  status: 'pending' | 'verified' | 'rejected'
  created_at: string
  verification_session_id?: string
}

type KycStatus = 'pending' | 'verified' | 'rejected' | null

export default function DriverKyc() {
  const { user, isDriver, isAdmin } = useAuth()
  const supabase = useSupabase()

  const [kycStatus, setKycStatus] = useState<KycStatus>(null)
  const [documents, setDocuments] = useState<KycDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isStartingVerification, setIsStartingVerification] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user) {
      fetchKycStatus()
    }
  }, [user, fetchKycStatus])

  // Role protection
  if (!user) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-yellow-600 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Login Required</h2>
            <p className="text-gray-600 mb-4">Please log in to access driver verification.</p>
            <Link href="/login">
              <Button>Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isDriver && !isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-red-600 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-gray-600 mb-4">Only drivers can access this verification process.</p>
            <Link href="/">
              <Button>Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const fetchKycStatus = useCallback(async () => {
    if (!user) return

    setIsLoading(true)
    try {
      // Get user profile to check current KYC status
      const { data: profile } = await supabase
        .from('profiles')
        .select('kyc_status')
        .eq('id', user.id)
        .single()

      setKycStatus(profile?.kyc_status || null)

      // Get KYC documents
      const { data: kycDocs } = await supabase
        .from('kyc_docs')
        .select('*')
        .eq('driver_id', user.id)
        .order('created_at', { ascending: false })

      setDocuments(kycDocs || [])
    } catch (error) {
      console.error('Error fetching KYC status:', error)
      setError('Failed to load verification status')
    } finally {
      setIsLoading(false)
    }
  }, [user, supabase])

  const startKycVerification = async () => {
    setIsStartingVerification(true)
    setError('')

    try {
      const response = await fetch('/api/kyc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document_type: 'drivers_license',
          return_url: `${window.location.origin}/driver/kyc`
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start verification')
      }

      if (data.verification_url) {
        // Redirect to Stripe Identity verification
        window.location.href = data.verification_url
      } else {
        throw new Error('No verification URL received')
      }
    } catch (error) {
      console.error('Error starting KYC:', error)
      setError(error instanceof Error ? error.message : 'Failed to start verification process')
    } finally {
      setIsStartingVerification(false)
    }
  }

  const getStatusColor = (status: KycStatus) => {
    switch (status) {
      case 'verified': return 'bg-green-100 text-green-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status: KycStatus) => {
    switch (status) {
      case 'verified': return <CheckCircle className="h-5 w-5 text-green-600" />
      case 'pending': return <Clock className="h-5 w-5 text-yellow-600" />
      case 'rejected': return <AlertCircle className="h-5 w-5 text-red-600" />
      default: return <FileText className="h-5 w-5 text-gray-600" />
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <div className="space-y-6">
          <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
          <div className="h-48 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="mx-auto max-w-4xl p-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <Shield className="h-16 w-16 mx-auto text-blue-600 mb-4" />
          <h1 className="text-3xl font-bold mb-2">Driver Verification</h1>
          <p className="text-gray-600">Complete your identity verification to start accepting deliveries</p>
        </div>

        {/* Current Status Card */}
        <Card className="mb-8 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              {getStatusIcon(kycStatus)}
              Verification Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <div>
                <Badge className={getStatusColor(kycStatus)} variant="secondary">
                  {kycStatus === 'verified' ? 'Verified' : 
                   kycStatus === 'pending' ? 'Under Review' : 
                   kycStatus === 'rejected' ? 'Rejected' : 'Not Started'}
                </Badge>
                <p className="text-sm text-gray-600 mt-2">
                  {kycStatus === 'verified' ? 
                    'Your identity has been verified. You can now accept delivery jobs!' :
                   kycStatus === 'pending' ? 
                    'Your documents are being reviewed. This usually takes 1-2 business days.' :
                   kycStatus === 'rejected' ? 
                    'Your verification was rejected. Please contact support or resubmit your documents.' :
                    'Complete identity verification to start earning as a driver.'}
                </p>
              </div>
              {kycStatus === 'verified' && (
                <Link href="/dashboard/driver">
                  <Button>
                    Go to Dashboard
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 mb-4">
                <div className="flex items-center">
                  <AlertCircle className="h-4 w-4 text-red-600 mr-2" />
                  <p className="text-red-700">{error}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Verification Steps */}
        <div className="grid gap-6 mb-8">
          {/* Identity Verification */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <FileCheck className="h-6 w-6 text-blue-600" />
                Identity Verification
              </CardTitle>
              <CardDescription>
                Verify your identity with a government-issued ID using our secure verification partner
              </CardDescription>
            </CardHeader>
            <CardContent>
              {kycStatus === 'verified' ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="font-medium text-green-800">Identity Verified</p>
                    <p className="text-sm text-green-700">Your identity has been successfully verified</p>
                  </div>
                </div>
              ) : kycStatus === 'pending' ? (
                <div className="flex items-center gap-3 p-4 bg-yellow-50 rounded-lg">
                  <Clock className="h-6 w-6 text-yellow-600" />
                  <div>
                    <p className="font-medium text-yellow-800">Verification In Progress</p>
                    <p className="text-sm text-yellow-700">Your documents are being reviewed</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">What You'll Need:</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        Valid government-issued photo ID (Driver&apos;s License, Passport, or State ID)
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        A smartphone or computer with a camera
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        5-10 minutes to complete the process
                      </li>
                    </ul>
                  </div>

                  <Button 
                    onClick={startKycVerification} 
                    disabled={isStartingVerification}
                    size="lg"
                    className="w-full"
                  >
                    {isStartingVerification ? 'Starting Verification...' : 'Start Identity Verification'}
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>

                  <p className="text-xs text-gray-500 text-center">
                    Powered by Stripe Identity - Your information is secure and encrypted
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Additional Requirements */}
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Car className="h-6 w-6 text-blue-600" />
                Driver Requirements
              </CardTitle>
              <CardDescription>
                Additional requirements for delivery drivers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-3">Before You Start:</h4>
                  <div className="grid gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                      <span className="text-sm">Must be 21+ years old</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                      <span className="text-sm">Valid driver&apos;s license</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                      <span className="text-sm">Vehicle insurance</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                      <span className="text-sm">Vehicle registration</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                      <span className="text-sm">Clean driving record</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Truck className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-800 mb-1">Ready to Earn?</p>
                      <p className="text-sm text-blue-700">
                        Once verified, you can start accepting delivery requests and earn money on your schedule.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Document History */}
        {documents.length > 0 && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Verification History</CardTitle>
              <CardDescription>
                Track the status of your submitted documents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-gray-400" />
                      <div>
                        <p className="font-medium capitalize">
                          {doc.doc_type.replace('_', ' ')}
                        </p>
                        <p className="text-sm text-gray-600">
                          Submitted {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(doc.status)} variant="secondary">
                      {doc.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Help Section */}
        <Card className="mt-8 shadow-lg">
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-blue-600 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Need Help?</h3>
            <p className="text-gray-600 mb-4">
              If you&apos;re having trouble with verification or have questions about the process, we&apos;re here to help.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button variant="outline">
                Contact Support
              </Button>
              <Button variant="outline">
                View FAQ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}