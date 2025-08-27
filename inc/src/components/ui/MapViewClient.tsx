'use client'

import dynamic from 'next/dynamic'
import { ComponentProps } from 'react'

// Import the actual MapView component type for props
type MapViewProps = ComponentProps<typeof import('./MapView').MapView>

// Dynamically import MapView with no SSR
const MapViewInternal = dynamic(() => import('./MapView').then(mod => ({ default: mod.MapView })), {
  ssr: false,
  loading: () => (
    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 flex items-center justify-center" style={{ height: '400px' }}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
        <p className="text-sm text-gray-600 dark:text-gray-400">Loading map...</p>
      </div>
    </div>
  )
})

// Re-export the MapLocation type
export type { MapLocation } from './MapView'

export function MapView(props: MapViewProps) {
  return <MapViewInternal {...props} />
}