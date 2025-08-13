import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export type RateLimitClient = {
  limit: (key: string) => Promise<{ success: boolean; remaining?: number; reset?: number }>
}

let ratelimit: Ratelimit | null = null

export function getRatelimit(): RateLimitClient {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    return {
      async limit() {
        return { success: true, remaining: 1, reset: 0 }
      },
    }
  }
  if (!ratelimit) {
    const redis = new Redis({ url, token })
    ratelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '10 s') })
  }
  return {
    async limit(key: string) {
      const res = await ratelimit!.limit(key)
      return { success: res.success, remaining: res.remaining, reset: Number(res.reset) }
    },
  }
}