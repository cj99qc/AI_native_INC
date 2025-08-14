'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default markers in Leaflet with webpack
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

export interface MapLocation {
  lat: number
  lng: number
  title?: string
  description?: string
  type?: 'vendor' | 'customer' | 'driver' | 'order'
}

interface MapViewProps {
  center?: [number, number]
  zoom?: number
  markers?: MapLocation[]
  height?: string
  className?: string
  onMapClick?: (lat: number, lng: number) => void
  onMarkerClick?: (location: MapLocation) => void
}

const markerColors = {
  vendor: '#10b981', // green
  customer: '#3b82f6', // blue  
  driver: '#8b5cf6', // purple
  order: '#f59e0b', // amber
  default: '#6b7280' // gray
}

export function MapView({
  center = [40.7128, -74.0060], // Default to NYC
  zoom = 13,
  markers = [],
  height = '400px',
  className = '',
  onMapClick,
  onMarkerClick
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])

  useEffect(() => {
    if (!mapRef.current) return

    // Initialize map
    const map = L.map(mapRef.current).setView(center, zoom)
    mapInstanceRef.current = map

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map)

    // Handle map clicks
    if (onMapClick) {
      map.on('click', (e) => {
        const { lat, lng } = e.latlng
        onMapClick(lat, lng)
      })
    }

    return () => {
      map.remove()
    }
  }, [center, zoom, onMapClick]) // Add dependencies

  // Update markers when markers prop changes
  useEffect(() => {
    if (!mapInstanceRef.current) return

    // Clear existing markers
    markersRef.current.forEach(marker => {
      mapInstanceRef.current?.removeLayer(marker)
    })
    markersRef.current = []

    // Add new markers
    markers.forEach((location) => {
      const color = markerColors[location.type || 'default']
      
      // Create custom icon
      const icon = new L.DivIcon({
        html: `
          <div style="
            background-color: ${color};
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          "></div>
        `,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        className: 'custom-marker'
      })

      const marker = L.marker([location.lat, location.lng], { icon })
      
      if (location.title || location.description) {
        const popupContent = `
          <div class="p-2">
            ${location.title ? `<h3 class="font-semibold text-sm">${location.title}</h3>` : ''}
            ${location.description ? `<p class="text-xs text-gray-600 mt-1">${location.description}</p>` : ''}
          </div>
        `
        marker.bindPopup(popupContent)
      }

      if (onMarkerClick) {
        marker.on('click', () => onMarkerClick(location))
      }

      marker.addTo(mapInstanceRef.current!)
      markersRef.current.push(marker)
    })

    // Auto-fit map to show all markers if there are any
    if (markers.length > 0) {
      const group = new L.FeatureGroup(markersRef.current)
      mapInstanceRef.current.fitBounds(group.getBounds().pad(0.1))
    }
  }, [markers, onMarkerClick])

  // Update center when center prop changes
  useEffect(() => {
    if (!mapInstanceRef.current) return
    mapInstanceRef.current.setView(center, zoom)
  }, [center, zoom])

  return (
    <div 
      ref={mapRef} 
      className={`rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 ${className}`}
      style={{ height }}
    />
  )
}