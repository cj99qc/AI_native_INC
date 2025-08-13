import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return <div className="p-4">Please log in to view orders.</div>
  const { data: orders } = await supabase.from('orders').select('*').or(`customer_id.eq.${user.id},vendor_id.eq.${user.id}`).order('created_at', { ascending: false })
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <ul className="space-y-2">
        {orders?.map(o => (
          <li key={o.id} className="rounded border p-3">
            <div className="text-sm text-muted-foreground">{o.status}</div>
            <div className="font-medium">Total: ${Number(o.total).toFixed(2)}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}