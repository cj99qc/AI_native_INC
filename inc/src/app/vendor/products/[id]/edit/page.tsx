'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ShoppingBag, Loader2, AlertCircle, Upload, X, CheckCircle, Trash2 } from 'lucide-react'
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

type ProductFormData = z.infer<typeof productSchema>

export default function ProductEditPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const productId = params?.id as string

  const [newImages, setNewImages] = useState<{ file: File; preview: string }[]>([])
  const [imageError, setImageError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

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

  const { data: productData, isLoading: productLoading } = useQuery({
    queryKey: ['product', productId],
    queryFn: async () => {
      const res = await fetch(`/api/products/${productId}`)
      if (!res.ok) throw new Error('Failed to fetch product')
      return res.json()
    },
    enabled: !!user && !!productId,
  })
  const product = productData?.product

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
  })

  useEffect(() => {
    if (product) {
      reset({
        name:        product.name,
        description: product.description,
        price:       product.price,
        category_id: product.category_id || '',
        unit:        product.unit || 'each',
        stock:       product.stock,
      })
    }
  }, [product, reset])

  if (authLoading || productLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Product not found</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/vendor">
              <Button className="w-full">Back to dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const totalImages = (product.images?.length || 0) + newImages.length + files.length

    if (totalImages > 5) {
      setImageError(`You can have a maximum of 5 images`)
      return
    }

    setImageError('')
    const addImages = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }))
    setNewImages((prev) => [...prev, ...addImages])
  }

  const removeNewImage = (index: number) => {
    setNewImages((prev) => {
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

      // Update product metadata
      const updateRes = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!updateRes.ok) {
        const error = await updateRes.json()
        throw new Error(error.message || 'Failed to update product')
      }

      // Upload new images
      if (newImages.length > 0) {
        const uploadedUrls = [...(product.images || [])]
        for (const img of newImages) {
          try {
            const result = await uploadProductImage(img.file, user!.id, productId)
            uploadedUrls.push(result.url)
          } catch (err) {
            console.warn('Image upload failed:', err)
          }
        }

        // Update product with all images
        await fetch(`/api/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: uploadedUrls }),
        })
      }

      setSuccess(true)
      setTimeout(() => router.push('/dashboard/vendor'), 1500)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/products/${productId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete product')
      router.push('/dashboard/vendor')
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to delete product')
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
              <CardTitle className="text-green-800">Product updated!</CardTitle>
              <CardDescription>Returning to dashboard…</CardDescription>
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
              <CardTitle className="text-2xl">Edit product</CardTitle>
              <CardDescription>{product.name}</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* Product Name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Product Name *</label>
                  <Input
                    {...register('name')}
                    className={errors.name ? 'border-red-500' : ''}
                  />
                  {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <textarea
                    {...register('description')}
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
                      className={errors.price ? 'border-red-500' : ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Unit</label>
                    <Input {...register('unit')} />
                  </div>
                </div>

                {/* Category & Stock */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Category</label>
                    <select
                      {...register('category_id')}
                      className="w-full px-3 py-2 border border-input bg-background text-sm rounded-md"
                    >
                      <option value="">Select a category</option>
                      {categories.map((cat: any) => (
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
                    />
                  </div>
                </div>

                <Separator />

                {/* Existing Images */}
                {product.images && product.images.length > 0 && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Current images</label>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {product.images.map((img: string, idx: number) => (
                        <img
                          key={idx}
                          src={img}
                          alt={`product-${idx}`}
                          className="w-full h-20 object-cover rounded-lg border border-gray-200"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* New Images */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">Add more images (max 5 total)</label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                      id="image-input-edit"
                    />
                    <label htmlFor="image-input-edit" className="flex flex-col items-center gap-2 cursor-pointer">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm font-medium">Click to upload images</span>
                    </label>
                  </div>

                  {imageError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{imageError}</p>
                    </div>
                  )}

                  {newImages.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {newImages.map((img, idx) => (
                        <div key={idx} className="relative group">
                          <img
                            src={img.preview}
                            alt={`new-${idx}`}
                            className="w-full h-20 object-cover rounded-lg border border-gray-200"
                          />
                          <button
                            type="button"
                            onClick={() => removeNewImage(idx)}
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

                <Separator />

                <div className="flex gap-4">
                  <Link href="/dashboard/vendor" className="flex-1">
                    <Button type="button" variant="outline" className="w-full">
                      Back
                    </Button>
                  </Link>
                  <Button type="submit" disabled={isSubmitting || uploading} className="flex-1">
                    {isSubmitting || uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save changes'
                    )}
                  </Button>
                </div>

                {/* Delete Button */}
                {!deleteConfirm ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setDeleteConfirm(true)}
                    className="w-full"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete product
                  </Button>
                ) : (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                    <p className="text-sm text-red-800">Are you sure you want to delete this product?</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDeleteConfirm(false)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button type="button" variant="destructive" onClick={handleDelete} className="flex-1">
                        Confirm delete
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
