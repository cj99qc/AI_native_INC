import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ results: [] })

    // Get user profile with location
    const { data: profile } = await supabase
      .from('profiles')
      .select('location, geo_point')
      .eq('id', user.id)
      .single()

    // Get user's recent events for AI analysis
    const { data: events } = await supabase
      .from('analytics_events')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    // Get user's order history for preferences
    const { data: orderHistory } = await supabase
      .from('orders')
      .select(`
        id,
        created_at,
        order_items!inner(
          product_id,
          quantity,
          products!inner(name, description, price, vendor_id)
        )
      `)
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    const openai = getOpenAI()
    
    // Generate AI-powered recommendations
    const analysisPrompt = `
      Analyze this user's behavior and generate personalized product recommendations:
      
      User Events: ${JSON.stringify(events?.slice(0, 50) || [])}
      Order History: ${JSON.stringify(orderHistory || [])}
      User Location: ${JSON.stringify(profile?.location || null)}
      
      Consider:
      1. Purchase patterns and preferences
      2. Time of day/week patterns
      3. Price sensitivity
      4. Location-based needs
      5. Seasonal trends
      
      Generate 10-15 specific product categories and types likely to interest this user.
      Return JSON array of objects with: {category, description, reasoning, urgency_score}
    `

    const completion = await openai.chat.completions.create({ 
      model: 'gpt-4o-mini', 
      messages: [{ role: 'user', content: analysisPrompt }],
      max_tokens: 1000,
      temperature: 0.3
    })

    let aiRecommendations = []
    try {
      aiRecommendations = JSON.parse(completion.choices[0]?.message?.content || '[]')
    } catch {
      aiRecommendations = [
        { category: 'Food & Groceries', description: 'Daily essentials', reasoning: 'Common need', urgency_score: 7 }
      ]
    }

    // Get location-based product recommendations
    let nearbyProducts = []
    if (profile?.location) {
      const { data: locationProducts } = await supabase
        .from('products')
        .select(`
          id, name, description, price, vendor_id,
          availability_radius_km, geo_point
        `)
        .not('geo_point', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100)

      // Filter by proximity
      if (locationProducts) {
        for (const product of locationProducts) {
          const maxRadius = product.availability_radius_km || 30
          
          const { data: isNearby } = await supabase.rpc('point_within_radius', {
            check_point: `POINT(${profile.location.lng} ${profile.location.lat})`,
            center_point: product.geo_point,
            radius_meters: maxRadius * 1000
          }).single()

          if (isNearby) {
            const { data: distance } = await supabase.rpc('calculate_distance', {
              point1: `POINT(${profile.location.lng} ${profile.location.lat})`,
              point2: product.geo_point
            }).single()

            nearbyProducts.push({
              ...product,
              distance_km: distance || 0
            })
          }
        }

        // Sort by distance and limit
        nearbyProducts = nearbyProducts
          .sort((a, b) => a.distance_km - b.distance_km)
          .slice(0, 20)
      }
    }

    // Generate semantic recommendations based on AI categories
    const semanticRecommendations = []
    for (const aiRec of aiRecommendations.slice(0, 5)) {
      try {
        const emb = await openai.embeddings.create({ 
          model: 'text-embedding-3-small', 
          input: `${aiRec.category} ${aiRec.description}` 
        })
        const vector = emb.data[0].embedding

        const { data: matches } = await supabase.rpc('match_products', {
          query_embedding: vector as unknown as number[],
          match_threshold: 0.2,
          match_count: 5,
        })

        if (matches) {
          semanticRecommendations.push(...matches.map((match: {id: string, name: string, description: string, price: number, similarity: number}) => ({
            ...match,
            recommendation_reason: aiRec.reasoning,
            category: aiRec.category,
            urgency_score: aiRec.urgency_score
          })))
        }
      } catch (embError) {
        console.error('Embedding generation failed:', embError)
      }
    }

    // Combine and rank all recommendations
    type RecommendationItem = {
      id: string
      similarity?: number
      distance_km?: number
      weight: number
      source: string
    }

    const allRecommendations: RecommendationItem[] = [
      ...semanticRecommendations.map((r) => ({ ...r, source: 'ai_semantic', weight: r.urgency_score || 5 })),
      ...nearbyProducts.map((r) => ({ 
        ...r, 
        source: 'location_based', 
        weight: Math.max(1, 10 - r.distance_km) // Closer = higher weight
      }))
    ]

    // Remove duplicates and sort by combined score
    const uniqueRecommendations = allRecommendations
      .filter((item, index, arr) => arr.findIndex(i => i.id === item.id) === index)
      .sort((a, b) => {
        const scoreA = (a.similarity || 0.5) * a.weight
        const scoreB = (b.similarity || 0.5) * b.weight
        return scoreB - scoreA
      })
      .slice(0, 15)

    // Log recommendation analytics
    await supabase
      .from('analytics_events')
      .insert({
        user_id: user.id,
        event_type: 'recommendations_generated',
        data: {
          total_recommendations: uniqueRecommendations.length,
          ai_categories: aiRecommendations.length,
          nearby_products: nearbyProducts.length,
          semantic_matches: semanticRecommendations.length,
          user_has_location: !!profile?.location
        },
        ai_insights: {
          ai_analysis: aiRecommendations.slice(0, 3),
          recommendation_sources: {
            ai_semantic: semanticRecommendations.length,
            location_based: nearbyProducts.length
          }
        }
      })

    return NextResponse.json({ 
      recommendations: uniqueRecommendations,
      ai_insights: aiRecommendations.slice(0, 5),
      location_based_count: nearbyProducts.length,
      semantic_count: semanticRecommendations.length
    })

  } catch (error) {
    console.error('Recommendations error:', error)
    return NextResponse.json({ 
      recommendations: [],
      error: 'Failed to generate recommendations'
    })
  }
}