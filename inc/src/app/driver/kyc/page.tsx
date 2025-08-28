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
  Upload, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  CreditCard,
  Car,
  FileCheck,
  Loader2,
  ExternalLink
} from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'

type DocumentType = 'drivers_license' | 'insurance' | 'vehicle_registration'
type KYCStatus = 'pending' | 'verified' | 'rejected'

interface KYCDocument {
  id: string
  doc_type: DocumentType
  status: KYCStatus
  stripe_verification_session_id: string
  created_at: string
  updated_at: string
}

const documentTypes = [
  {
    type: 'drivers_license' as DocumentType,
    title: "Driver&apos;s License",
    description: 'Valid government-issued driver&apos;s license',
    icon: CreditCard,
    required: true
  },
  {
    type: 'insurance' as DocumentType,
    title: 'Auto Insurance',
    description: 'Current vehicle insurance policy',
    icon: Shield,
    required: true
  },
  {
    type: 'vehicle_registration' as DocumentType,
    title: 'Vehicle Registration',
    description: 'Current vehicle registration document',
    icon: Car,
    required: true
  }
]

export default function DriverKYCPage() {
  const { user, isDriver, isAdmin, loading: authLoading } = useAuth()
  const supabase = useSupabase()
  const router = useRouter()
  
  const [loading, setLoading] = useState(false)
  const [documents, setDocuments] = useState<KYCDocument[]>([])
  const [kycStatus, setKycStatus] = useState<KYCStatus>('pending')
  const [error, setError] = useState('')

  const [selectedDocument, setSelectedDocument] = useState<DocumentType | null>(null)

  const fetchKYCStatus = useCallback(async () => {
    if (!user) return
    
    try {
      // Get profile KYC status
      const { data: profile } = await supabase
        .from('profiles')
        .select('kyc_status')
        .eq('id', user.id)
        .single()
      
      setKycStatus(profile?.kyc_status || 'pending')
      
      // Get KYC documents
      const { data: docs } = await supabase
        .from('kyc_docs')
        .select('*')
        .eq('driver_id', user.id)
        .order('created_at', { ascending: false })
      
      setDocuments(docs || [])
      
      // If already verified, redirect to dashboard
      if (profile?.kyc_status === 'verified') {
        setTimeout(() => {
          router.push('/dashboard/driver')
        }, 2000)
      }
      
    } catch (error) {
      console.error('Error fetching KYC status:', error)
      setError('Failed to load verification status')
    }
  }, [user, supabase, router])

  useEffect(() => {
    if (user && !authLoading) {
      fetchKYCStatus()
    }
  }, [user, authLoading, fetchKYCStatus])

  // Role protection
  if (!authLoading && user && !isDriver && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <Shield className="h-6 w-6 text-red-600" />
            </div>
            <CardTitle className="text-red-800">Access Denied</CardTitle>
            <CardDescription className="text-red-600">
              This page is only accessible to drivers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button className="w-full">Return Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }



  const startVerification = async (documentType: DocumentType) => {
    if (!user) return
    
    setLoading(true)
    setError('')
    setSelectedDocument(documentType)
    
    try {
      const response = await fetch('/api/kyc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document_type: documentType,
          return_url: `${window.location.origin}/driver/kyc`
        }),
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to start verification')
      }
      
      const data = await response.json()
      
      if (data.verification_url) {
        // Redirect to Stripe verification
        window.location.href = data.verification_url
      } else {
        throw new Error('No verification URL received')
      }
      
    } catch (error) {
      console.error('Verification error:', error)
      setError(error instanceof Error ? error.message : 'Failed to start verification')
    } finally {
      setLoading(false)
      setSelectedDocument(null)
    }
  }

  const getDocumentStatus = (documentType: DocumentType): KYCDocument | null => {
    return documents.find(doc => doc.doc_type === documentType) || null
  }

  const getStatusColor = (status: KYCStatus) => {
    switch (status) {
      case 'verified': return 'bg-green-100 text-green-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status: KYCStatus) => {
    switch (status) {
      case 'verified': return <CheckCircle className="h-4 w-4" />
      case 'pending': return <Clock className="h-4 w-4" />
      case 'rejected': return <AlertCircle className="h-4 w-4" />
      default: return <FileText className="h-4 w-4" />
    }
  }

  const allDocumentsVerified = documentTypes
    .filter(doc => doc.required)
    .every(doc => {
      const status = getDocumentStatus(doc.type)
      return status?.status === 'verified'
    })

  if (kycStatus === 'verified' && allDocumentsVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-green-800">Verification Complete!</CardTitle>
              <CardDescription>
                You&apos;re all set to start accepting delivery jobs. 
                Redirecting to your driver dashboard...
              </CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-4xl pt-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <Shield className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Driver Verification</h1>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Complete your identity verification to start accepting delivery jobs. 
              This helps keep our platform safe and secure for everyone.
            </p>
          </div>

          {/* Overall Status */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Verification Status
                    {getStatusIcon(kycStatus)}
                  </CardTitle>
                  <CardDescription>
                    {kycStatus === 'verified' && allDocumentsVerified
                      ? 'All documents verified - you can start driving!'
                      : kycStatus === 'pending'
                      ? 'Please upload required documents to complete verification'
                      : 'Some documents need attention'}
                  </CardDescription>
                </div>
                <Badge className={getStatusColor(kycStatus)}>
                  {kycStatus}
                </Badge>
              </div>
            </CardHeader>
          </Card>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-6"
            >
              <Card className="border-red-200 bg-red-50">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Documents Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
            {documentTypes.map((docType) => {
              const docStatus = getDocumentStatus(docType.type)
              const IconComponent = docType.icon
              
              return (
                <Card key={docType.type} className="relative">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                          <IconComponent className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{docType.title}</CardTitle>
                          <CardDescription className="text-sm">
                            {docType.description}
                          </CardDescription>
                        </div>
                      </div>
                      {docType.required && (
                        <Badge variant="outline" className="text-xs">
                          Required
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  
                  <CardContent>
                    {docStatus ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Status:</span>
                          <Badge className={getStatusColor(docStatus.status)}>
                            {getStatusIcon(docStatus.status)}
                            <span className="ml-1">{docStatus.status}</span>
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-600">
                          Uploaded: {new Date(docStatus.created_at).toLocaleDateString()}
                        </p>
                        {docStatus.status === 'rejected' && (
                          <Button
                            onClick={() => startVerification(docType.type)}
                            disabled={loading}
                            size="sm"
                            className="w-full"
                          >
                            Re-upload Document
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button
                        onClick={() => startVerification(docType.type)}
                        disabled={loading}
                        className="w-full"
                      >
                        {loading && selectedDocument === docType.type ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Starting...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            Upload {docType.title}
                          </>
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Information Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Verification Requirements
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="font-medium mb-2">What you&apos;ll need:</h4>
                  <ul className="space-y-1 text-sm text-gray-600">
                    <li>• Valid driver&apos;s license</li>
                    <li>• Current auto insurance policy</li>
                    <li>• Vehicle registration document</li>
                    <li>• Clear photos of all documents</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Verification process:</h4>
                  <ul className="space-y-1 text-sm text-gray-600">
                    <li>• Documents are reviewed by our secure partner</li>
                    <li>• Verification typically takes 1-2 business days</li>
                    <li>• You&apos;ll receive email updates on status changes</li>
                    <li>• All data is encrypted and stored securely</li>
                  </ul>
                </div>
              </div>
              
              <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                <Shield className="h-4 w-4 text-blue-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-blue-800">Your privacy is protected</p>
                  <p className="text-blue-700">
                    We use industry-leading security measures to protect your personal information. 
                    Documents are processed by our trusted verification partner and are never stored permanently.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex gap-4 mt-8">
            <Link href="/dashboard/driver" className="flex-1">
              <Button variant="outline" className="w-full">
                Back to Dashboard
              </Button>
            </Link>
            {kycStatus === 'verified' && allDocumentsVerified && (
              <Link href="/dashboard/driver" className="flex-1">
                <Button className="w-full">
                  Start Driving
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}