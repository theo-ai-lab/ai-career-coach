/**
 * Unit tests for service-config.
 * Injectable env map only — no real secrets, no DB, no key.
 * Run: npx tsx --test lib/service-config.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getServiceConfig,
  SERVICE_UNAVAILABLE_PAYLOAD,
} from './service-config';

const FULL = {
  // Non-secret placeholders: getServiceConfig only checks presence, never the
  // value. Deliberately not a real key shape.
  OPENAI_API_KEY: 'openai-key-placeholder',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder',
};

test('fully configured env -> ready, nothing missing', () => {
  const cfg = getServiceConfig(FULL);
  assert.equal(cfg.openai, true);
  assert.equal(cfg.supabase, true);
  assert.equal(cfg.ready, true);
  assert.deepEqual(cfg.missing, []);
});

test('empty env -> not ready, all three vars reported missing', () => {
  const cfg = getServiceConfig({});
  assert.equal(cfg.ready, false);
  assert.equal(cfg.openai, false);
  assert.equal(cfg.supabase, false);
  assert.deepEqual(cfg.missing, [
    'OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
});

test('missing only the OpenAI key -> supabase ok, not ready', () => {
  const { OPENAI_API_KEY, ...rest } = FULL;
  void OPENAI_API_KEY;
  const cfg = getServiceConfig(rest);
  assert.equal(cfg.openai, false);
  assert.equal(cfg.supabase, true);
  assert.equal(cfg.ready, false);
  assert.deepEqual(cfg.missing, ['OPENAI_API_KEY']);
});

test('missing only the Supabase service-role key -> openai ok, not ready', () => {
  const { SUPABASE_SERVICE_ROLE_KEY, ...rest } = FULL;
  void SUPABASE_SERVICE_ROLE_KEY;
  const cfg = getServiceConfig(rest);
  assert.equal(cfg.openai, true);
  assert.equal(cfg.supabase, false);
  assert.equal(cfg.ready, false);
  assert.deepEqual(cfg.missing, ['SUPABASE_SERVICE_ROLE_KEY']);
});

test('whitespace-only values count as missing (not configured)', () => {
  const cfg = getServiceConfig({
    OPENAI_API_KEY: '   ',
    NEXT_PUBLIC_SUPABASE_URL: '\t',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.equal(cfg.ready, false);
  assert.equal(cfg.missing.length, 3);
});

test('unavailable payload never leaks key names and stays client-safe', () => {
  // The client-facing payload must not enumerate which env vars are missing.
  const serialized = JSON.stringify(SERVICE_UNAVAILABLE_PAYLOAD);
  assert.equal(SERVICE_UNAVAILABLE_PAYLOAD.configured, false);
  assert.equal(SERVICE_UNAVAILABLE_PAYLOAD.error, 'service_unavailable');
  assert.ok(!serialized.includes('OPENAI_API_KEY'));
  assert.ok(!serialized.includes('SUPABASE_SERVICE_ROLE_KEY'));
});
