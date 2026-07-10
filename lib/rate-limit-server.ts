import { NextResponse } from 'next/server';

import {
  TokenBucketLimiter,
  decideRateLimit,
  type RateLimitSurface,
} from './rate-limit';

/**
 * rate-limit-server.ts
 *
 * The ONE process-wide limiter every unauthenticated route shares, and the
 * three-line binding each route calls FIRST — before body parsing, before
 * the config/liveness honesty gates, before any OpenAI spend:
 *
 *   const limited = enforceRateLimit(req, 'query');
 *   if (limited) return limited;
 *
 * Shared on purpose (same reasoning as backend-liveness-server): one bucket
 * map per instance means one surface's budget is enforced consistently no
 * matter which route file the request hits. Per-instance and in-memory —
 * the honest caveats (serverless instance fan-out, cold-start resets, the
 * shared-store upgrade this is pending) are documented in lib/rate-limit.ts
 * and docs/PRODUCTION_SECURITY_VERIFICATION.md.
 *
 * The decision logic lives in lib/rate-limit.ts (pure, unit-tested offline
 * including the exact 429 contract); this module only wraps the decision in
 * a NextResponse.
 */

const limiter = new TokenBucketLimiter();

/**
 * Returns the designed 429 response when this request exceeds its surface's
 * per-IP budget, or null to let the route proceed.
 */
export function enforceRateLimit(
  req: Request,
  surface: RateLimitSurface,
): NextResponse | null {
  const decision = decideRateLimit(req.headers, surface, limiter);
  if (decision.allowed) return null;
  return NextResponse.json(decision.body, {
    status: decision.status,
    headers: { 'Retry-After': String(decision.retryAfterSeconds) },
  });
}
