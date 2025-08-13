import { createServerSupabase } from '@/lib/supabase/server'
import AIChatWidget from '@/components/features/AIChatWidget'

export const dynamic = 'force-dynamic'

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()
  const { data: product } = await supabase.from('products').select('*').eq('id', id).single()
  if (!product) return <div className="p-4">Product not found.</div>
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="rounded border p-4">
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <p className="text-muted-foreground">{product.description}</p>
        <div className="text-xl text-primary">${Number(product.price).toFixed(2)}</div>
      </div>
      <AIChatWidget contextId={product.id} contextType="product" />
    </div>
  )
}