/**
 * Simple token-bucket rate limiter.
 *
 * Rate limits are keyed on AR session_id (from tool parameters) — NOT on
 * MCP transport session IDs. This correctly scopes limits to AR sessions
 * so a reconnecting MCP client doesn't reset its window.
 *
 * Read tools without a session_id param use the key "global".
 */

interface Bucket {
  count: number;
  windowStart: number;
}

export type RateLimitTier = "read" | "write" | "batch";

export interface RateLimits {
  read: number;
  write: number;
  batch: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  read: 50,
  write: 100,
  batch: 10,
};

const WINDOW_MS = 1000;
const MAX_SLOTS = 1000;

export class RateLimiter {
  private readonly limits: RateLimits;
  /** Map key: `${sessionId}:${tier}` → bucket */
  private readonly buckets = new Map<string, Bucket>();

  constructor(limits: RateLimits = DEFAULT_RATE_LIMITS) {
    this.limits = limits;
  }

  /**
   * Returns true if the request is allowed, false if rate-limited.
   * @param sessionId  AR session_id, or "global" for session-less read tools
   * @param tier       read | write | batch
   */
  check(sessionId: string, tier: RateLimitTier): boolean {
    const key = `${sessionId}:${tier}`;
    const now = Date.now();
    const limit = this.limits[tier];

    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      // Evict old entries if map is too large
      if (!bucket && this.buckets.size >= MAX_SLOTS) {
        this.evictOldest();
      }
      bucket = { count: 0, windowStart: now };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }

  private evictOldest(): void {
    // Remove the first ~10% of entries (oldest by insertion order)
    const toRemove = Math.ceil(MAX_SLOTS * 0.1);
    let removed = 0;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (++removed >= toRemove) break;
    }
  }
}
