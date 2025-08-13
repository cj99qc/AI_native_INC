'use client'

import { useState, useEffect, useCallback } from 'react'

export interface GeolocationData {
  latitude: number
  longitude: number
  accuracy: number
  heading?: number
  speed?: number
  altitude?: number
  timestamp: number
}

export interface GeolocationError {
  code: number
  message: string
}

export interface UseGeolocationOptions {
  enableHighAccuracy?: boolean
  timeout?: number
  maximumAge?: number
  watch?: boolean
  onSuccess?: (position: GeolocationData) => void
  onError?: (error: GeolocationError) => void
}

export interface UseGeolocationReturn {
  location: GeolocationData | null
  error: GeolocationError | null
  loading: boolean
  supported: boolean
  permission: PermissionState | null
  getCurrentLocation: () => Promise<GeolocationData>
  startWatching: () => void
  stopWatching: () => void
  requestPermission: () => Promise<PermissionState>
}

export function useGeolocation(options: UseGeolocationOptions = {}): UseGeolocationReturn {
  const {
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 60000,
    watch = false,
    onSuccess,
    onError
  } = options

  const [location, setLocation] = useState<GeolocationData | null>(null)
  const [error, setError] = useState<GeolocationError | null>(null)
  const [loading, setLoading] = useState(false)
  const [permission, setPermission] = useState<PermissionState | null>(null)
  const [watchId, setWatchId] = useState<number | null>(null)

  const supported = typeof window !== 'undefined' && 'geolocation' in navigator

  // Check permission status
  useEffect(() => {
    if (!supported) return

    const checkPermission = async () => {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' })
        setPermission(result.state)
        
        result.addEventListener('change', () => {
          setPermission(result.state)
        })
      } catch {
        console.warn('Permission API not supported')
      }
    }

    checkPermission()
  }, [supported])

  const handleSuccess = useCallback((position: GeolocationPosition) => {
    const locationData: GeolocationData = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: position.coords.heading || undefined,
      speed: position.coords.speed || undefined,
      altitude: position.coords.altitude || undefined,
      timestamp: position.timestamp
    }

    setLocation(locationData)
    setError(null)
    setLoading(false)
    onSuccess?.(locationData)
  }, [onSuccess])

  const handleError = useCallback((err: GeolocationPositionError) => {
    const errorData: GeolocationError = {
      code: err.code,
      message: err.message
    }

    setError(errorData)
    setLocation(null)
    setLoading(false)
    onError?.(errorData)
  }, [onError])

  const getCurrentLocation = useCallback((): Promise<GeolocationData> => {
    return new Promise((resolve, reject) => {
      if (!supported) {
        reject(new Error('Geolocation is not supported'))
        return
      }

      setLoading(true)
      setError(null)

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const locationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading || undefined,
            speed: position.coords.speed || undefined,
            altitude: position.coords.altitude || undefined,
            timestamp: position.timestamp
          }
          handleSuccess(position)
          resolve(locationData)
        },
        (err) => {
          handleError(err)
          reject(err)
        },
        {
          enableHighAccuracy,
          timeout,
          maximumAge
        }
      )
    })
  }, [supported, enableHighAccuracy, timeout, maximumAge, handleSuccess, handleError])

  const startWatching = useCallback(() => {
    if (!supported || watchId !== null) return

    setLoading(true)
    setError(null)

    const id = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy,
        timeout,
        maximumAge
      }
    )

    setWatchId(id)
  }, [supported, watchId, handleSuccess, handleError, enableHighAccuracy, timeout, maximumAge])

  const stopWatching = useCallback(() => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      setWatchId(null)
      setLoading(false)
    }
  }, [watchId])

  const requestPermission = useCallback(async (): Promise<PermissionState> => {
    if (!supported) {
      throw new Error('Geolocation is not supported')
    }

    try {
      // Try to get current position to trigger permission request
      await getCurrentLocation()
      return 'granted'
    } catch (err) {
      if (err instanceof GeolocationPositionError) {
        if (err.code === err.PERMISSION_DENIED) {
          setPermission('denied')
          return 'denied'
        }
      }
      throw err
    }
  }, [supported, getCurrentLocation])

  // Auto-start watching if enabled
  useEffect(() => {
    if (watch && supported && permission === 'granted') {
      startWatching()
    }

    return () => {
      if (watchId !== null) {
        stopWatching()
      }
    }
  }, [watch, supported, permission, startWatching, stopWatching, watchId])

  return {
    location,
    error,
    loading,
    supported,
    permission,
    getCurrentLocation,
    startWatching,
    stopWatching,
    requestPermission
  }
}

// Helper hook for driver heartbeat functionality
export function useDriverHeartbeat(intervalMs: number = 15000) {
  const [isActive, setIsActive] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const { location, getCurrentLocation } = useGeolocation({
    enableHighAccuracy: true,
    watch: true
  })

  const sendHeartbeat = useCallback(async (currentLocation?: GeolocationData) => {
    try {
      const locationData = currentLocation || await getCurrentLocation()
      
      const response = await fetch('/api/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          location: {
            lat: locationData.latitude,
            lng: locationData.longitude
          },
          isActive
        })
      })

      if (response.ok) {
        setLastUpdate(new Date())
      }
    } catch (error) {
      console.error('Heartbeat failed:', error)
    }
  }, [getCurrentLocation, isActive])

  // Send heartbeat on location updates
  useEffect(() => {
    if (location && isActive) {
      sendHeartbeat(location)
    }
  }, [location, isActive, sendHeartbeat])

  // Periodic heartbeat
  useEffect(() => {
    if (!isActive) return

    const interval = setInterval(() => {
      sendHeartbeat()
    }, intervalMs)

    return () => clearInterval(interval)
  }, [isActive, intervalMs, sendHeartbeat])

  const startHeartbeat = useCallback(() => {
    setIsActive(true)
    sendHeartbeat() // Send immediate heartbeat
  }, [sendHeartbeat])

  const stopHeartbeat = useCallback(() => {
    setIsActive(false)
  }, [])

  return {
    isActive,
    lastUpdate,
    location,
    startHeartbeat,
    stopHeartbeat,
    sendHeartbeat
  }
}