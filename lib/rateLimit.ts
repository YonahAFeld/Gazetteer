/**
 * Tiny in-memory token bucket, keyed by client (per-IP for the hydrate route,
 * SPEC.md §4). Process-local — fine for a single hosted instance; swap for a
 * shared store if the app is ever scaled horizontally.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Sustained requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Consume one token for `key`. Returns whether the request is allowed plus the
 * seconds until at least one token is available again.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const refillPerMs = limit / windowMs;
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };

  // Refill proportionally to elapsed time, capped at `limit`.
  bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { allowed: true, retryAfter: 0 };
  }

  buckets.set(key, bucket);
  const retryAfter = Math.ceil((1 - bucket.tokens) / refillPerMs / 1000);
  return { allowed: false, retryAfter };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
