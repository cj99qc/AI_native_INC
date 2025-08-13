import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function VendorDashboard() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-4">Login required.</div>
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Vendor Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded border p-4">Products overview</div>
        <div className="rounded border p-4">Delivery jobs overview</div>
      </div>
    </div>
  )
}