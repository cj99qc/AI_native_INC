'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { LocationConsentModal } from '@/components/ui/LocationConsentModal'
import { useSupabase } from '@/providers/SupabaseProvider'
import { useAuth } from '@/hooks/useAuth'

export interface LocationData {
  latitude: number
  longitude: number
  accuracy?: number
  address?: string
  city?: string
  country?: string
}

interface LocationContextType {
  location: LocationData | null
  loading: boolean
  error: string | null
  permission: 'granted' | 'denied' | 'prompt' | null
  requestLocation: () => Promise<void>
  updateLocation: (location: LocationData) => Promise<void>
  clearLocation: () => void
}

const LocationContext = createContext<LocationContextType | null>(null)

interface LocationProviderProps {
  children: ReactNode
  autoRequest?: boolean
}

export function LocationProvider({ children, autoRequest = true }: LocationProviderProps) {
  const supabase = useSupabase()
  const { user } = useAuth()
  
  const [location, setLocation] = useState<LocationData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt' | null>(null)
  const [showConsentModal, setShowConsentModal] = useState(false)

  // Check if user has previously given consent
  useEffect(() => {
    const hasAskedPermission = localStorage.getItem('location_permission_asked')
    const userChoice = localStorage.getItem('location_permission_choice')
    
    if (userChoice === 'granted') {
      setPermission('granted')
      if (autoRequest) {
        getCurrentLocation()
      }
    } else if (userChoice === 'denied') {
      setPermission('denied')
    } else if (!hasAskedPermission && autoRequest) {
      // First time user, show consent modal
      setShowConsentModal(true)
    }
  }, [autoRequest])

  // Check browser geolocation permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setPermission(result.state as 'granted' | 'denied' | 'prompt')
      })
    }
  }, [])

  const getCurrentLocation = async (): Promise<LocationData | null> => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser')
      return null
    }

    setLoading(true)
    setError(null)

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000 // 5 minutes
          }
        )
      })

      const locationData: LocationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      }

      // Try to get address from coordinates
      try {
        const address = await reverseGeocode(locationData.latitude, locationData.longitude)
        locationData.address = address.address
        locationData.city = address.city
        locationData.country = address.country
      } catch (geocodeError) {
        console.warn('Reverse geocoding failed:', geocodeError)
      }

      setLocation(locationData)
      setPermission('granted')
      
      // Save to user profile if authenticated
      if (user) {
        await updateUserLocation(locationData)
      }

      return locationData
    } catch (err) {
      const error = err as GeolocationPositionError
      let errorMessage = 'Failed to get location'
      
      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMessage = 'Location access denied'
          setPermission('denied')
          break
        case error.POSITION_UNAVAILABLE:
          errorMessage = 'Location information unavailable'
          break
        case error.TIMEOUT:
          errorMessage = 'Location request timed out'
          break
      }
      
      setError(errorMessage)
      return null
    } finally {
      setLoading(false)
    }
  }

  const reverseGeocode = async (lat: number, lng: number) => {
    // Using Nominatim for reverse geocoding (free alternative to Google)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'InC-App/1.0'
        }
      }
    )
    
    if (!response.ok) {
      throw new Error('Geocoding failed')
    }
    
    const data = await response.json()
    
    return {
      address: data.display_name || '',
      city: data.address?.city || data.address?.town || data.address?.village || '',
      country: data.address?.country || ''
    }
  }

  const updateUserLocation = async (locationData: LocationData) => {
    if (!user) return

    try {
      await supabase
        .from('profiles')
        .update({
          location: {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            address: locationData.address,
            city: locationData.city,
            country: locationData.country,
            updated_at: new Date().toISOString()
          },
          geo_point: `POINT(${locationData.longitude} ${locationData.latitude})`
        })
        .eq('id', user.id)
    } catch (error) {
      console.error('Failed to update user location:', error)
    }
  }

  const requestLocation = async () => {
    await getCurrentLocation()
  }

  const updateLocation = async (newLocation: LocationData) => {
    setLocation(newLocation)
    if (user) {
      await updateUserLocation(newLocation)
    }
  }

  const clearLocation = () => {
    setLocation(null)
    setError(null)
    localStorage.removeItem('location_permission_choice')
  }

  const handleConsentAccept = async () => {
    localStorage.setItem('location_permission_asked', 'true')
    localStorage.setItem('location_permission_choice', 'granted')
    setShowConsentModal(false)
    await getCurrentLocation()
  }

  const handleConsentDecline = () => {
    localStorage.setItem('location_permission_asked', 'true')
    localStorage.setItem('location_permission_choice', 'denied')
    setPermission('denied')
    setShowConsentModal(false)
  }

  const handleConsentClose = () => {
    localStorage.setItem('location_permission_asked', 'true')
    setShowConsentModal(false)
  }

  const value: LocationContextType = {
    location,
    loading,
    error,
    permission,
    requestLocation,
    updateLocation,
    clearLocation
  }

  return (
    <LocationContext.Provider value={value}>
      {children}
      <LocationConsentModal
        isOpen={showConsentModal}
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
        onClose={handleConsentClose}
      />
    </LocationContext.Provider>
  )
}

export function useLocation() {
  const context = useContext(LocationContext)
  if (!context) {
    throw new Error('useLocation must be used within a LocationProvider')
  }
  return context
}