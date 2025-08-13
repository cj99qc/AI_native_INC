import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function VendorProducts() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-4">Login required.</div>
  const { data: products } = await supabase.from('products').select('*').eq('vendor_id', user.id)
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Your Products</h1>
      <pre className="rounded bg-muted p-4 text-xs">{JSON.stringify(products, null, 2)}</pre>
    </div>
  )
}