'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ShoppingBag, Loader2, AlertCircle, Upload, X, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { uploadProductImage } from '@/lib/supabase/storage'

const productSchema = z.object({
  name:        z.string().min(1, 'Product name is required').max(200),
  description: z.string().max(2000).optional(),
  price:       z.number().min(0.01, 'Price must be at least ₹0.01'),
  category_id: z.string().uuid('Invalid category').optional(),
  unit:        z.string().max(20).default('each'),
  stock:       z.number().int().min(0).default(0),
})

type ProductFormInput = z.input<typeof productSchema>
type ProductFormData = z.output<typeof productSchema>

export default function ProductCreatePage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [images, setImages] = useState<{ file: File; preview: string }[]>([])
  const [imageError, setImageError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormInput, unknown, ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      unit: 'each',
      stock: 0,
    },
  })

  // Fetch categories
  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const res = await fetch('/api/product-categories')
      if (!res.ok) throw new Error('Failed to fetch categories')
      return res.json()
    },
    enabled: !!user,
  })
  const categories = categoriesData?.categories || []

  const price = watch('price')
  const categoryId = watch('category_id')

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in to add products</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/auth/login">
              <Button className="w-full">Sign in</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const totalImages = images.length + files.length

    if (totalImages > 5) {
      setImageError(`You can upload a maximum of 5 images (currently have ${images.length}, trying to add ${files.length})`)
      return
    }

    setImageError('')
    const newImages = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }))
    setImages((prev) => [...prev, ...newImages])
  }

  const removeImage = (index: number) => {
    setImages((prev) => {
      const updated = [...prev]
      URL.revokeObjectURL(updated[index].preview)
      updated.splice(index, 1)
      return updated
    })
  }

  const onSubmit = async (data: ProductFormData) => {
    setSubmitError('')

    try {
      setUploading(true)

      // Step 1: Create the product row first
      const createRes = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          images: [], // Empty for now; upload images in step 2
        }),
      })

      if (!createRes.ok) {
        const error = await createRes.json()
        throw new Error(error.message || 'Failed to create product')
      }

      const { product } = await createRes.json()

      // Step 2: Upload images if any
      if (images.length > 0) {
        const uploadedUrls: string[] = []
        for (const img of images) {
          try {
            const result = await uploadProductImage(img.file, user.id, product.id)
            uploadedUrls.push(result.url)
          } catch (err) {
            console.warn('[ProductCreate] Image upload failed, continuing:', err)
            // Non-fatal: product is created, just without this image
          }
        }

        // Update product with image URLs
        if (uploadedUrls.length > 0) {
          await fetch(`/api/products/${product.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: uploadedUrls }),
          })
        }
      }

      setSuccess(true)
      setTimeout(() => {
        router.push(`/vendor/products/${product.id}/edit`)
      }, 1500)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setUploading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-green-800">Product created!</CardTitle>
              <CardDescription>Taking you to the edit page…</CardDescription>
            </CardHeader>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-3xl pt-8 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <ShoppingBag className="h-8 w-8 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">List a product</CardTitle>
              <CardDescription>Tell customers what you&apos;re selling</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* Product Name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Product Name *</label>
                  <Input
                    {...register('name')}
                    placeholder="e.g. Whole Wheat Flour 1kg"
                    className={errors.name ? 'border-red-500' : ''}
                  />
                  {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <textarea
                    {...register('description')}
                    placeholder="Describe your product (optional)"
                    className="w-full min-h-[100px] px-3 py-2 border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none rounded-md"
                  />
                </div>

                <Separator />

                {/* Price & Unit */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Price (₹) *</label>
                    <Input
                      {...register('price', { valueAsNumber: true })}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className={errors.price ? 'border-red-500' : ''}
                    />
                    {errors.price && <p className="text-xs text-red-500">{errors.price.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Unit</label>
                    <Input
                      {...register('unit')}
                      placeholder="each, kg, litre, etc."
                    />
                  </div>
                </div>

                {/* Category & Stock */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Category</label>
                    <select
                      {...register('category_id')}
                      className="w-full px-3 py-2 border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
                    >
                      <option value="">Select a category</option>
                      {categories.map((cat: { id: string; name: string }) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Stock</label>
                    <Input
                      {...register('stock', { valueAsNumber: true })}
                      type="number"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                </div>

                <Separator />

                {/* Images */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Product Images (max 5)</label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors cursor-pointer">
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                      id="image-input"
                    />
                    <label htmlFor="image-input" className="flex flex-col items-center gap-2 cursor-pointer">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm font-medium">Click to upload or drag images</span>
                      <span className="text-xs text-muted-foreground">{images.length} of 5 images</span>
                    </label>
                  </div>

                  {imageError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{imageError}</p>
                    </div>
                  )}

                  {/* Image Preview Grid */}
                  {images.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {images.map((img, idx) => (
                        <div key={idx} className="relative group">
                          <img
                            src={img.preview}
                            alt={`preview-${idx}`}
                            className="w-full h-20 object-cover rounded-lg border border-gray-200"
                          />
                          <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {submitError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3 rounded-lg bg-red-50 border border-red-200 flex gap-2"
                  >
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{submitError}</p>
                  </motion.div>
                )}

                <div className="flex gap-4">
                  <Link href="/dashboard/vendor" className="flex-1">
                    <Button type="button" variant="outline" className="w-full">
                      Cancel
                    </Button>
                  </Link>
                  <Button type="submit" disabled={isSubmitting || uploading} className="flex-1">
                    {isSubmitting || uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {uploading ? 'Uploading…' : 'Creating…'}
                      </>
                    ) : (
                      'Add to catalog'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
