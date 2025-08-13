import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DriverJobs() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-4">Login required.</div>
  const { data: jobs } = await supabase.from('delivery_jobs').select('*').order('created_at', { ascending: false })
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Your Jobs</h1>
      <pre className="rounded bg-muted p-4 text-xs">{JSON.stringify(jobs, null, 2)}</pre>
    </div>
  )
}