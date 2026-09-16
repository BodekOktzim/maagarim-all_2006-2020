/**
 * Token-bucket rate limiter (section 43). In-process Map-based implementation —
 * fine for a single API instance; a production multi-instance deployment would
 * back this with Redis (same interface, swappable), which isn't available in
 * this sandbox (no redis-server binary, no network to install ioredis).
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerSecond: number,
  ) {}

  /** Returns true if the request is allowed, false if the key is rate-limited. */
  tryConsume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsedSec * this.refillPerSecond);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
}
