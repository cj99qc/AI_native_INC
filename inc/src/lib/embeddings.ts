import { getOpenAI } from './openai'

/**
 * Generate a text embedding for a product using OpenAI text-embedding-3-small.
 * Used for semantic search: customers search "flour" and find all products whose
 * embeddings are similar to the query embedding.
 *
 * @param text The text to embed (e.g., "Aashirvaad Whole Wheat Flour 1kg Groceries")
 * @returns A 384-dimensional vector (text-embedding-3-small model)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text')
  }

  try {
    const response = await getOpenAI().embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
    })

    const embedding = response.data[0].embedding
    if (!embedding || embedding.length === 0) {
      throw new Error('OpenAI returned empty embedding')
    }

    return embedding
  } catch (error) {
    console.error('[generateEmbedding] OpenAI error:', error)
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

/**
 * Generate a product embedding from name, description, and category.
 * This text is used for semantic search matching.
 *
 * @param product Object with name, description, and category (or category slug)
 * @returns A 384-dimensional vector
 */
export async function generateProductEmbedding(product: {
  name: string
  description?: string | null
  category?: string | null
}): Promise<number[]> {
  const parts = [
    product.name,
    product.description ? `${product.description}` : '',
    product.category ? `${product.category}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return generateEmbedding(parts)
}
