/**
 * Unit tests for rate-limit — the per-IP token-bucket limiter every
 * unauthenticated API route runs FIRST, before any parse, probe, or OpenAI
 * spend. Pure module: injectable clock, no network, no env.
 *
 * The contract locked here is the route-level 429 branch: request N+1 from
 * one address inside the refill window returns the designed 429 payload
 * (client-safe copy, Retry-After seconds), while other addresses and other
 * surfaces are unaffected.
 *
 * Run: npx tsx --test lib/rate-limit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TokenBucketLimiter,
  RATE_LIMIT_POLICIES,
  RATE_LIMITED_PAYLOAD,
  clientKeyFromHeaders,
  decideRateLimit,
  type RateLimitSurface,
} from './rate-limit';

function makeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    advanceSeconds(s: number) {
      t += s * 1000;
    },
  };
}

function headersOf(map: Record<string, string>) {
  return new Headers(map);
}

// ---------------------------------------------------------------------------
// Token-bucket math
// ---------------------------------------------------------------------------

test('a burst up to capacity is allowed; the next request is denied', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now });
  const policy = { id: 'p', capacity: 3, refillPerMinute: 3 };

  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.check('ip-a', policy).allowed, true, `burst ${i + 1}`);
  }
  const denied = limiter.check('ip-a', policy);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSeconds >= 1, 'denials carry a Retry-After');
});

test('tokens refill with the clock; a denied key recovers after the window', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now });
  const policy = { id: 'p', capacity: 2, refillPerMinute: 2 }; // 1 token / 30s

  assert.equal(limiter.check('ip-a', policy).allowed, true);
  assert.equal(limiter.check('ip-a', policy).allowed, true);
  assert.equal(limiter.check('ip-a', policy).allowed, false);

  clock.advanceSeconds(10); // 1/3 token back — still short of one
  assert.equal(limiter.check('ip-a', policy).allowed, false);

  clock.advanceSeconds(25); // > 30s total: at least one full token back
  assert.equal(limiter.check('ip-a', policy).allowed, true);
});

test('refill never exceeds capacity (no infinite banking)', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now });
  const policy = { id: 'p', capacity: 2, refillPerMinute: 60 };

  clock.advanceSeconds(3600); // an hour idle must not bank 3600 tokens
  assert.equal(limiter.check('ip-a', policy).allowed, true);
  assert.equal(limiter.check('ip-a', policy).allowed, true);
  assert.equal(limiter.check('ip-a', policy).allowed, false);
});

test('retryAfterSeconds reflects the actual time to the next token', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now });
  const policy = { id: 'p', capacity: 1, refillPerMinute: 4 }; // 15s per token

  assert.equal(limiter.check('ip-a', policy).allowed, true);
  const denied = limiter.check('ip-a', policy);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 15);
});

test('keys are isolated: one address exhausting its bucket never affects another', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now });
  const policy = { id: 'p', capacity: 1, refillPerMinute: 1 };

  assert.equal(limiter.check('ip-a', policy).allowed, true);
  assert.equal(limiter.check('ip-a', policy).allowed, false);
  assert.equal(limiter.check('ip-b', policy).allowed, true, 'ip-b unaffected');
});

test('bucket count is bounded: unbounded attacker-minted keys cannot exhaust memory', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now, maxKeys: 3 });
  const policy = { id: 'p', capacity: 1, refillPerMinute: 1 };

  for (let i = 0; i < 50; i++) {
    limiter.check(`ip-${i}`, policy);
  }
  assert.ok(
    limiter.size() <= 3,
    `bucket map must stay bounded (got ${limiter.size()})`,
  );
  // The limiter still functions after eviction pressure.
  assert.equal(limiter.check('ip-fresh', policy).allowed, true);
  assert.equal(limiter.check('ip-fresh', policy).allowed, false);
});

// ---------------------------------------------------------------------------
// Client key extraction
// ---------------------------------------------------------------------------

test('clientKeyFromHeaders: first x-forwarded-for hop, trimmed', () => {
  const key = clientKeyFromHeaders(
    headersOf({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1, 10.0.0.2' }),
  );
  assert.equal(key, '203.0.113.9');
});

test('clientKeyFromHeaders: falls back to x-real-ip, then a shared bucket', () => {
  assert.equal(
    clientKeyFromHeaders(headersOf({ 'x-real-ip': '198.51.100.7' })),
    '198.51.100.7',
  );
  assert.equal(clientKeyFromHeaders(headersOf({})), 'unknown');
});

// ---------------------------------------------------------------------------
// Policy table — every unauthenticated surface is covered
// ---------------------------------------------------------------------------

test('policies exist for every unauthenticated surface class', () => {
  const surfaces = Object.keys(RATE_LIMIT_POLICIES).sort();
  assert.deepEqual(surfaces, [
    'agents',
    'demo',
    'evals',
    'health',
    'query',
    'upload',
  ]);
  for (const [name, policy] of Object.entries(RATE_LIMIT_POLICIES)) {
    assert.ok(policy.capacity >= 1, `${name}: capacity`);
    assert.ok(policy.refillPerMinute > 0, `${name}: refill`);
    assert.equal(policy.id, name, `${name}: id mirrors the surface name`);
  }
});

test('token-spending surfaces are strictly tighter than the keyless ones', () => {
  for (const spender of ['query', 'agents', 'evals', 'upload'] as const) {
    for (const keyless of ['demo', 'health'] as const) {
      assert.ok(
        RATE_LIMIT_POLICIES[spender].capacity <
          RATE_LIMIT_POLICIES[keyless].capacity,
        `${spender} burst < ${keyless} burst`,
      );
      assert.ok(
        RATE_LIMIT_POLICIES[spender].refillPerMinute <
          RATE_LIMIT_POLICIES[keyless].refillPerMinute,
        `${spender} sustained < ${keyless} sustained`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The designed 429 payload
// ---------------------------------------------------------------------------

test('RATE_LIMITED_PAYLOAD is client-safe and renders on the existing notice surface', () => {
  const text = JSON.stringify(RATE_LIMITED_PAYLOAD);
  assert.equal(RATE_LIMITED_PAYLOAD.error, 'rate_limited');
  assert.ok(
    RATE_LIMITED_PAYLOAD.message.length > 0,
    'the UI renders data.message on non-OK responses',
  );
  for (const secret of [
    'OPENAI_API_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'env',
  ]) {
    assert.ok(!text.includes(secret), `payload must not mention ${secret}`);
  }
});

// ---------------------------------------------------------------------------
// Route-level contract: the 429 branch exactly as the routes serve it
// ---------------------------------------------------------------------------

test('ROUTE CONTRACT: request capacity+1 from one IP -> designed 429; another IP unaffected', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now });
  const abuser = headersOf({ 'x-forwarded-for': '203.0.113.9' });
  const bystander = headersOf({ 'x-forwarded-for': '198.51.100.7' });

  const cap = RATE_LIMIT_POLICIES.query.capacity;
  for (let i = 0; i < cap; i++) {
    assert.deepEqual(decideRateLimit(abuser, 'query', limiter), {
      allowed: true,
    });
  }

  const denied = decideRateLimit(abuser, 'query', limiter);
  assert.equal(denied.allowed, false);
  if (!denied.allowed) {
    assert.equal(denied.status, 429);
    assert.deepEqual(denied.body, RATE_LIMITED_PAYLOAD);
    assert.ok(denied.retryAfterSeconds >= 1);
  }

  assert.deepEqual(decideRateLimit(bystander, 'query', limiter), {
    allowed: true,
  });
});

test('ROUTE CONTRACT: surfaces have independent buckets for the same IP', () => {
  const clock = makeClock();
  const limiter = new TokenBucketLimiter({ now: clock.now });
  const ip = headersOf({ 'x-forwarded-for': '203.0.113.9' });

  // Exhaust the query bucket entirely.
  for (let i = 0; i <= RATE_LIMIT_POLICIES.query.capacity; i++) {
    decideRateLimit(ip, 'query', limiter);
  }
  assert.equal(decideRateLimit(ip, 'query', limiter).allowed, false);

  // The same IP's demo and health budgets are untouched.
  for (const surface of ['demo', 'health'] as RateLimitSurface[]) {
    assert.equal(
      decideRateLimit(ip, surface, limiter).allowed,
      true,
      `${surface} bucket is independent of the exhausted query bucket`,
    );
  }
});
