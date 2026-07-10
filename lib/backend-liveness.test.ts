/**
 * Unit tests for backend-liveness.
 *
 * The dead backend is a mock probe — no DB, no network, no key. These tests
 * lock the honesty semantics the live route depends on: a backend that is
 * configured but unreachable must surface as NOT alive (so the route can
 * return its designed 503) and must never be mistaken for a healthy empty
 * retrieval.
 *
 * Run: npx tsx --test lib/backend-liveness.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLivenessChecker,
  BACKEND_UNAVAILABLE_PAYLOAD,
} from './backend-liveness';

test('dead backend (probe rejects) -> not alive, reason probe-failed', async () => {
  const checker = createLivenessChecker({
    probe: async () => {
      throw new Error('fetch failed'); // what a dead Supabase looks like
    },
  });
  const result = await checker.check();
  assert.equal(result.alive, false);
  assert.equal(result.source, 'probe');
  assert.equal(result.reason, 'probe-failed');
});

test('live backend (probe resolves) -> alive', async () => {
  const checker = createLivenessChecker({ probe: async () => {} });
  const result = await checker.check();
  assert.equal(result.alive, true);
  assert.equal(result.source, 'probe');
  assert.equal(result.reason, null);
});

test('probe that throws synchronously is handled as dead, not an exception', async () => {
  const checker = createLivenessChecker({
    probe: () => {
      throw new Error('sync explosion');
    },
  });
  const result = await checker.check();
  assert.equal(result.alive, false);
  assert.equal(result.reason, 'probe-failed');
});

test('hanging backend (probe never settles) -> dead within the timeout', async () => {
  const checker = createLivenessChecker({
    probe: () => new Promise<void>(() => {}), // never settles
    timeoutMs: 25,
  });
  const result = await checker.check();
  assert.equal(result.alive, false);
  assert.equal(result.reason, 'probe-timeout');
});

test('alive result is cached: second check within TTL does not re-probe', async () => {
  let probes = 0;
  let clock = 0;
  const checker = createLivenessChecker({
    probe: async () => {
      probes += 1;
    },
    ttlMs: 1000,
    now: () => clock,
  });

  const first = await checker.check();
  clock = 500; // inside TTL
  const second = await checker.check();

  assert.equal(probes, 1);
  assert.equal(first.source, 'probe');
  assert.equal(second.source, 'cache');
  assert.equal(second.alive, true);
});

test('dead result is cached too: a dead backend is not hammered inside TTL', async () => {
  let probes = 0;
  let clock = 0;
  const checker = createLivenessChecker({
    probe: async () => {
      probes += 1;
      throw new Error('down');
    },
    ttlMs: 1000,
    now: () => clock,
  });

  await checker.check();
  clock = 500;
  const second = await checker.check();

  assert.equal(probes, 1);
  assert.equal(second.alive, false);
  assert.equal(second.source, 'cache');
});

test('TTL expiry re-probes, so a revived backend recovers', async () => {
  let probes = 0;
  let backendUp = false;
  let clock = 0;
  const checker = createLivenessChecker({
    probe: async () => {
      probes += 1;
      if (!backendUp) throw new Error('down');
    },
    ttlMs: 1000,
    now: () => clock,
  });

  const whileDead = await checker.check();
  assert.equal(whileDead.alive, false);

  backendUp = true;
  clock = 1001; // past TTL
  const afterRevival = await checker.check();

  assert.equal(probes, 2);
  assert.equal(afterRevival.alive, true);
  assert.equal(afterRevival.source, 'probe');
});

test('reportDead() flips a cached-alive checker to dead immediately', async () => {
  let probes = 0;
  let clock = 0;
  const checker = createLivenessChecker({
    probe: async () => {
      probes += 1;
    },
    ttlMs: 1000,
    now: () => clock,
  });

  const before = await checker.check();
  assert.equal(before.alive, true);

  // Mid-request RPC failure: the route reports it so subsequent requests
  // fail fast on the cache instead of re-discovering the dead backend.
  checker.reportDead();
  clock = 500; // still inside the original TTL
  const after = await checker.check();

  assert.equal(after.alive, false);
  assert.equal(after.source, 'cache');
  assert.equal(after.reason, 'reported-dead');
  assert.equal(probes, 1); // no extra probe needed to know it is dead

  // ...and TTL expiry still allows recovery via a fresh probe.
  clock = 1600;
  const recovered = await checker.check();
  assert.equal(recovered.alive, true);
  assert.equal(probes, 2);
});

test('concurrent checks share a single in-flight probe', async () => {
  let probes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const checker = createLivenessChecker({
    probe: () => {
      probes += 1;
      return gate;
    },
  });

  const a = checker.check();
  const b = checker.check();
  // The probe starts on a microtask (sync-throw safety); yield so it runs
  // before releasing it.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes, 1, 'both checks should share one started probe');
  release();
  const [ra, rb] = await Promise.all([a, b]);

  assert.equal(probes, 1);
  assert.equal(ra.alive, true);
  assert.equal(rb.alive, true);
});

test('unavailable payload is client-safe and distinct from the not-configured state', () => {
  // This payload fires when config IS present but the backend is dead — the
  // exact case that used to be masked as HTTP 200 "No relevant experience
  // found.". It must never leak env var names or backend internals.
  const serialized = JSON.stringify(BACKEND_UNAVAILABLE_PAYLOAD);
  assert.equal(BACKEND_UNAVAILABLE_PAYLOAD.error, 'service_unavailable');
  assert.equal(BACKEND_UNAVAILABLE_PAYLOAD.configured, true);
  assert.ok(BACKEND_UNAVAILABLE_PAYLOAD.message.length > 0);
  assert.ok(!serialized.includes('OPENAI_API_KEY'));
  assert.ok(!serialized.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(!serialized.includes('supabase.co'));
  // The masked-failure string must never be part of this surface.
  assert.ok(!serialized.includes('No relevant experience found'));
});
