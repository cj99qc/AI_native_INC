'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MapPin, Navigation, Shield, X } from 'lucide-react'

interface LocationConsentModalProps {
  isOpen: boolean
  onAccept: () => void
  onDecline: () => void
  onClose: () => void
}

export function LocationConsentModal({ isOpen, onAccept, onDecline, onClose }: LocationConsentModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <div className="flex min-h-screen items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
          >
            <Card className="shadow-2xl border-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm">
              <CardHeader className="text-center pb-4">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    className="h-8 w-8 p-0 rounded-full"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: "spring" }}
                  className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-purple-600"
                >
                  <Navigation className="h-8 w-8 text-white" />
                </motion.div>
                
                <CardTitle className="text-xl font-bold text-gray-900 dark:text-white">
                  Enable Location Access
                </CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-400">
                  Get better results and discover businesses near you
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                {/* Benefits */}
                <div className="space-y-4">
                  {[
                    {
                      icon: MapPin,
                      title: 'Nearby Recommendations',
                      description: 'Find restaurants, stores, and services in your area'
                    },
                    {
                      icon: Navigation,
                      title: 'Accurate Delivery',
                      description: 'Get precise delivery times and real-time tracking'
                    },
                    {
                      icon: Shield,
                      title: 'Privacy Protected',
                      description: 'Your location is only used to improve your experience'
                    }
                  ].map((benefit, index) => (
                    <motion.div
                      key={benefit.title}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + index * 0.1 }}
                      className="flex items-start gap-3"
                    >
                      <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                        <benefit.icon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 dark:text-white text-sm">
                          {benefit.title}
                        </h4>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {benefit.description}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Privacy Note */}
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    <Shield className="inline h-3 w-3 mr-1" />
                    We only use your location when the app is open. You can change this in settings anytime.
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3">
                  <Button
                    onClick={onAccept}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    Allow Location Access
                  </Button>
                  <Button
                    onClick={onDecline}
                    variant="outline"
                    className="w-full"
                  >
                    Continue Without Location
                  </Button>
                </div>

                <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                  You can manually enter your address if you prefer not to share your location
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}