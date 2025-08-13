'use client'

import { useEffect } from 'react'
import { useSupabase } from '@/providers/SupabaseProvider'

export function useRealtime<TPayload = unknown>(channel: string, onMessage: (payload: TPayload) => void) {
  const supabase = useSupabase()
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (supabase.channel(channel) as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: '*', schema: 'public' } as any, (payload: any) => onMessage(payload as TPayload))
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [channel, onMessage, supabase])
}