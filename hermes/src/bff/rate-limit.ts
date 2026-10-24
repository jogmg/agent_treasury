export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Small in-memory sliding-window limiter. The BFF is intended to run as a
 * single instance behind a tunnel/reverse proxy; if it is scaled out, replace
 * this with Redis or a Postgres-backed limiter.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): RateLimitResult {
    const now = this.now()
    const cutoff = now - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff)
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      }
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 5_000) this.cleanup(now)
    return {
      allowed: true,
      remaining: Math.max(0, this.limit - recent.length),
      retryAfterSeconds: 0,
    }
  }

  cleanup(now: number = this.now()): void {
    const cutoff = now - this.windowMs
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff)
      if (recent.length === 0) this.hits.delete(key)
      else this.hits.set(key, recent)
    }
  }
}
