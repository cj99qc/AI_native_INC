import { createBrowserSupabase } from './client'

const PRODUCT_IMAGES_BUCKET = 'product-images'

export type UploadProductImageResult = {
  url: string
  path: string
  size: number
}

/**
 * Upload a product image to Supabase Storage.
 * Path: `vendor_id/product_id/filename`
 *
 * @param file The image file to upload
 * @param vendorId UUID of the vendor
 * @param productId UUID of the product (use temp ID like 'pending' if not yet created)
 * @returns Public URL and metadata
 */
export async function uploadProductImage(
  file: File,
  vendorId: string,
  productId: string
): Promise<UploadProductImageResult> {
  const supabase = createBrowserSupabase()

  // Validate file
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are allowed')
  }
  if (file.size > 5 * 1024 * 1024) {
    // 5 MB limit
    throw new Error('File size must be less than 5 MB')
  }

  // Generate unique filename
  const ext = file.name.split('.').pop() || 'jpg'
  const timestamp = Date.now()
  const randomStr = Math.random().toString(36).substring(7)
  const filename = `${timestamp}-${randomStr}.${ext}`
  const path = `${vendorId}/${productId}/${filename}`

  // Upload
  const { data, error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, { upsert: false, cacheControl: '3600' })

  if (error) {
    console.error('[uploadProductImage] storage error:', error)
    throw new Error(`Failed to upload image: ${error.message}`)
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(data.path)

  return {
    url: publicUrl,
    path: data.path,
    size: file.size,
  }
}

/**
 * Delete a product image from storage.
 * @param path The full path in storage (vendor_id/product_id/filename)
 */
export async function deleteProductImage(path: string): Promise<void> {
  const supabase = createBrowserSupabase()

  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])

  if (error) {
    console.error('[deleteProductImage] storage error:', error)
    throw new Error(`Failed to delete image: ${error.message}`)
  }
}

/**
 * Get a public URL for a product image (without re-uploading).
 * Useful for rendering existing images.
 */
export function getProductImageUrl(path: string): string {
  const supabase = createBrowserSupabase()
  const {
    data: { publicUrl },
  } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path)
  return publicUrl
}
