/**
 * rate-limit.ts
 *
 * Per-IP token-bucket rate limiting for every unauthenticated API surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every API route in this app is unauthenticated, and most of them spend
 * OpenAI tokens on demand: /api/query (embed + generate + judge),
 * /api/upload (one embedding per chunk), all seven /api/agents/* routes
 * (ChatOpenAI chains), and /api/evals/coaching-quality (a judge call). A
 * single caller in a loop converts directly into an unbounded bill. The
 * keyless surfaces (/api/demo/query, /api/health) spend nothing but are
 * still a DoS surface. Each route therefore runs this gate FIRST — before
 * body parsing, before the config/liveness gates, before any spend.
 *
 * DESIGN
 * ------
 * Classic token bucket per (surface, client-IP) pair: `capacity` is the
 * allowed burst, `refillPerMinute` the sustained rate. Denials return the
 * seconds until the next token so routes can send an honest Retry-After.
 *
 * Pure and injectable (clock via constructor), matching the repo's
 * quality-gates pattern: the decision logic is unit-tested offline in
 * lib/rate-limit.test.ts, and lib/rate-limit-server.ts binds ONE
 * process-wide limiter for all routes.
 *
 * HONEST LIMITS OF THIS IMPLEMENTATION
 * ------------------------------------
 * - Per-instance, in-memory: on serverless, each warm instance has its own
 *   buckets and cold starts reset them, so the effective global limit is
 *   (instances x budget). That still caps a naive abuse loop hitting a warm
 *   instance; a distributed attacker needs a shared store (Upstash/WAF) to
 *   stop, which is the documented production upgrade (pending), not this.
 * - IP extraction trusts the platform's x-forwarded-for. Behind Vercel the
 *   platform sets it; on bare `next dev` the header is client-controlled
 *   and missing headers share one "unknown" bucket.
 * Both caveats live in docs/PRODUCTION_SECURITY_VERIFICATION.md.
 */

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export interface RateLimitPolicy {
  /** Surface name; namespaces the bucket key. */
  id: string;
  /** Maximum burst (bucket size). */
  capacity: number;
  /** Sustained tokens per minute once the burst is spent. */
  refillPerMinute: number;
}

/**
 * One policy per unauthenticated surface class. The budgets are sized for a
 * single human using the product (a coaching chat runs at a few requests per
 * minute), not calibrated on production traffic — traffic-derived limits are
 * pending real traffic, like every other live number in this repo.
 * Token-SPENDING surfaces get strictly tighter budgets than keyless ones;
 * lib/rate-limit.test.ts enforces that invariant.
 */
export const RATE_LIMIT_POLICIES = {
  /** /api/query — embed + generate + judge per request. */
  query: { id: 'query', capacity: 8, refillPerMinute: 4 },
  /** /api/agents/* — ChatOpenAI chains (report runs an 8-node graph). */
  agents: { id: 'agents', capacity: 8, refillPerMinute: 4 },
  /** /api/evals/coaching-quality — one judge call per request. */
  evals: { id: 'evals', capacity: 8, refillPerMinute: 4 },
  /** /api/upload — PDF parse + one embedding per chunk. */
  upload: { id: 'upload', capacity: 4, refillPerMinute: 2 },
  /** /api/demo/query — keyless, zero spend; DoS ceiling only. */
  demo: { id: 'demo', capacity: 30, refillPerMinute: 20 },
  /** /api/health — keyless, zero spend; generous for uptime monitors. */
  health: { id: 'health', capacity: 60, refillPerMinute: 30 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitSurface = keyof typeof RATE_LIMIT_POLICIES;

// ---------------------------------------------------------------------------
// The designed 429 payload
// ---------------------------------------------------------------------------

/**
 * Client-safe 429 body. The chat UI renders `message` on its existing
 * non-OK notice surface (app/page.tsx), so a rate-limited caller sees an
 * honest "slow down" instead of a fabricated answer or a raw error. Never
 * names env vars, keys, or budgets.
 */
export const RATE_LIMITED_PAYLOAD = {
  error: 'rate_limited',
  message:
    'Too many requests from this address in a short window. Please wait a moment and try again.',
} as const;

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the next token; 0 when allowed. */
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedMs: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(options: { now?: () => number; maxKeys?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /** Number of live buckets (bounded; see evictIfNeeded). */
  size(): number {
    return this.buckets.size;
  }

  /**
   * Spend one token from `key`'s bucket under `policy`. Never throws: a
   * rate limiter that can crash a route is worse than no rate limiter.
   */
  check(key: string, policy: RateLimitPolicy): RateLimitDecision {
    const nowMs = this.now();
    let bucket = this.buckets.get(key);

    if (bucket) {
      // Lazy refill since last touch, capped at capacity (no banking).
      const elapsedMs = Math.max(0, nowMs - bucket.updatedMs);
      bucket.tokens = Math.min(
        policy.capacity,
        bucket.tokens + (elapsedMs / 60_000) * policy.refillPerMinute,
      );
      bucket.updatedMs = nowMs;
      // Re-insert so Map iteration order approximates least-recently-used.
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    } else {
      this.evictIfNeeded();
      bucket = { tokens: policy.capacity, updatedMs: nowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const secondsPerToken = 60 / policy.refillPerMinute;
    const deficit = 1 - bucket.tokens;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(deficit * secondsPerToken)),
    };
  }

  /**
   * Bound memory against attacker-minted keys (e.g. rotating spoofed IPs on
   * a direct origin hit): past maxKeys, drop the least-recently-touched
   * buckets. Evicting an old bucket refunds at most one burst — bounded and
   * acceptable; unbounded memory is not.
   */
  private evictIfNeeded(): void {
    if (this.buckets.size < this.maxKeys) return;
    const toDrop = this.buckets.size - this.maxKeys + 1;
    let dropped = 0;
    for (const key of this.buckets.keys()) {
      if (dropped >= toDrop) break;
      this.buckets.delete(key);
      dropped += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Client key extraction
// ---------------------------------------------------------------------------

interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Best-available client identity for the bucket key. Behind Vercel the
 * platform sets x-forwarded-for (leftmost hop = client); x-real-ip is the
 * fallback. With neither header every caller shares one "unknown" bucket —
 * deliberately fail-CLOSED for anonymity: an unattributable flood is still
 * capped rather than unmetered.
 */
export function clientKeyFromHeaders(headers: HeadersLike): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Route-level decision (the exact contract the routes serve)
// ---------------------------------------------------------------------------

export type RouteRateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: 429;
      body: typeof RATE_LIMITED_PAYLOAD;
      retryAfterSeconds: number;
    };

/**
 * The full per-request decision: extract the client key, spend a token on
 * this surface's bucket, and shape the designed 429 on denial. Routes wrap
 * this in a Response via lib/rate-limit-server.ts; tests exercise it
 * directly (route-level contract without HTTP, like coach-pipeline).
 */
export function decideRateLimit(
  headers: HeadersLike,
  surface: RateLimitSurface,
  limiter: TokenBucketLimiter,
): RouteRateLimitDecision {
  const policy = RATE_LIMIT_POLICIES[surface];
  const key = `${policy.id}:${clientKeyFromHeaders(headers)}`;
  const decision = limiter.check(key, policy);
  if (decision.allowed) return { allowed: true };
  return {
    allowed: false,
    status: 429,
    body: RATE_LIMITED_PAYLOAD,
    retryAfterSeconds: decision.retryAfterSeconds,
  };
}
