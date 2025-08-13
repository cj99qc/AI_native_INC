import { createServerSupabase } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function ProductGrid() {
  const supabase = await createServerSupabase()
  const { data: products, error } = await supabase.from('products').select('id,name,description,price,images').order('created_at', { ascending: false }).limit(12)
  if (error) {
    return <div className="text-red-500">Failed to load products</div>
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products?.map(p => (
        <Link key={p.id} href={`/product/${p.id}`} className="rounded border p-4 hover:shadow">
          <div className="font-medium">{p.name}</div>
          <div className="truncate text-sm text-muted-foreground">{p.description}</div>
          <div className="mt-2 text-primary">${Number(p.price).toFixed(2)}</div>
        </Link>
      ))}
    </div>
  )
}