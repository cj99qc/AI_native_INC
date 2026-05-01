import { createServerSupabase } from '@/lib/supabase/server'
import AIChatWidget from '@/components/features/AIChatWidget'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Image from 'next/image'

export const dynamic = 'force-dynamic'

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabase()

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .single()

  if (!product) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-4">
        <Card>
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-semibold text-gray-700">Product not found</h2>
            <p className="text-gray-600">This product is no longer available.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Fetch vendor info for context
  const { data: vendor } = await supabase
    .from('vendors')
    .select('business_name, rating')
    .eq('id', product.vendor_id)
    .single()

  // Fetch category name if available
  const { data: category } = product.category_id ? await supabase
    .from('product_categories')
    .select('name')
    .eq('id', product.category_id)
    .single() : { data: null }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      {/* Product Gallery and Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Image Gallery */}
        <div className="space-y-4">
          {product.images && product.images.length > 0 ? (
            <>
              <div className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                <Image
                  src={product.images[0]}
                  alt={product.name}
                  fill
                  className="object-cover"
                  priority
                />
              </div>
              {product.images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {product.images.map((img: string, idx: number) => (
                    <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                      <Image
                        src={img}
                        alt={`${product.name}-${idx}`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="aspect-square rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200">
              <span className="text-gray-400 text-sm">No image available</span>
            </div>
          )}
        </div>

        {/* Product Info */}
        <Card>
          <CardContent className="p-6 space-y-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">{product.name}</h1>
              {vendor && (
                <p className="text-sm text-gray-600 mb-3">
                  Sold by <span className="font-medium">{vendor.business_name}</span>
                  {vendor.rating && <span className="ml-2">⭐ {vendor.rating.toFixed(1)}</span>}
                </p>
              )}
              {product.description && (
                <p className="text-gray-600">{product.description}</p>
              )}
            </div>

            {/* Price and Availability */}
            <div className="border-y py-4 space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-green-600">
                  ₹{Number(product.price).toFixed(2)}
                </span>
                <span className="text-sm text-gray-500">per {product.unit || 'unit'}</span>
              </div>

              {product.stock !== undefined && (
                <div>
                  <Badge variant={product.stock > 0 ? 'default' : 'destructive'}>
                    {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                  </Badge>
                </div>
              )}
            </div>

            {/* Product Details */}
            <div className="space-y-3">
              {category && (
                <div>
                  <p className="text-sm text-gray-600">Category</p>
                  <p className="font-medium">{category.name}</p>
                </div>
              )}

              {product.unit && (
                <div>
                  <p className="text-sm text-gray-600">Unit</p>
                  <p className="font-medium">{product.unit}</p>
                </div>
              )}

              {product.currency && (
                <div>
                  <p className="text-sm text-gray-600">Currency</p>
                  <p className="font-medium">{product.currency}</p>
                </div>
              )}
            </div>

            {/* Add to Cart Placeholder */}
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors">
              Add to Cart
            </button>
          </CardContent>
        </Card>
      </div>

      {/* AI Chat Widget */}
      <Card>
        <CardHeader>
          <CardTitle>Questions?</CardTitle>
          <CardDescription>Ask about this product</CardDescription>
        </CardHeader>
        <CardContent>
          <AIChatWidget contextId={product.id} contextType="product" />
        </CardContent>
      </Card>
    </div>
  )
}