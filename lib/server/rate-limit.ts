/**
 * Interim in-memory fixed-window rate limiter.
 *
 * Best-effort ONLY: counters live in a single serverless instance's memory, so
 * they don't coordinate across Vercel's instances and reset on cold start. It
 * throttles a caller hammering one warm instance and establishes the 429
 * contract (limit, remaining, retry-after). Swap the backend for Upstash /
 * Vercel KV for durable, cross-instance limiting without changing callers.
 */
export interface RateResult {
  limited: boolean
  remaining: number
  retryAfterSeconds: number
}

const WINDOW_MS = 60_000
const LIMIT = 30

const hits = new Map<string, { count: number; resetAt: number }>()

export const RATE_LIMIT_MAX = LIMIT

export function rateLimit(key: string, now: number = Date.now()): RateResult {
  // Opportunistic cleanup so the map can't grow without bound.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k)
  }

  const entry = hits.get(key)
  if (!entry || now >= entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { limited: false, remaining: LIMIT - 1, retryAfterSeconds: 0 }
  }

  if (entry.count >= LIMIT) {
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    }
  }

  entry.count++
  return { limited: false, remaining: LIMIT - entry.count, retryAfterSeconds: 0 }
}
