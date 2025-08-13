import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DriverDashboard() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-4">Login required.</div>
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Driver Dashboard</h1>
      <div className="rounded border p-4">Available jobs and AI routes (coming soon)</div>
    </div>
  )
}