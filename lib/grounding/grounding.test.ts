/**
 * Offline tests for the grounding gate orchestrator + transport.
 *
 * The Pacioli HTTP call is MOCKED via an injected `fetchImpl`, so the full round
 * trip — request shaping, response parsing, verdict mapping, and graceful
 * degradation — is exercised with NO network and NO Pacioli server. A REAL round
 * trip against a locally-run Pacioli dev server is in scripts/grounding-roundtrip.ts.
 *
 * Run: npx tsx --test lib/grounding/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runGroundingGate } from './index';
import { reconcileClaims } from './pacioli-client';
import type { GroundingConfig } from './config';

const CONFIG: GroundingConfig = {
  url: 'http://pacioli.test/api/reconcile',
  apiKey: 'test-key',
  judge: 'anthropic',
  timeoutMs: 5000,
  evidenceLabel: 'resume',
};

/** Build a fake fetch that records the request and returns a crafted Response. */
function mockFetch(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return responder(String(url), init ?? {});
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// A Pacioli batch response with one unsupported (judge) verdict.
function flaggedBody() {
  return {
    merchant: 'resume',
    judgeMode: 'anthropic',
    claims: [
      {
        id: 'claim-0',
        agent: 'career-coach',
        status: 'unsupported',
        balanced: true,
        findings: [],
        judgeFindings: [
          {
            type: 'CLAIM_MISMATCH',
            dimension: 'item',
            severity: 'high',
            claimedRef: 'cataloging is feature engineering',
            actualRef: 'library science coursework',
            llmAssisted: true,
            note: 'Cataloging is metadata standardization, not feature engineering.',
          },
        ],
        deltaUsd: null,
        likelyCause: null,
        receiptId: 'sha256:abc0000000000000',
        receiptHash: 'sha256:def0000000000000',
      },
      {
        id: 'claim-1',
        agent: 'career-coach',
        status: 'supported',
        balanced: true,
        findings: [],
        judgeFindings: [],
        deltaUsd: null,
        likelyCause: null,
        receiptId: 'sha256:abc1111111111111',
        receiptHash: 'sha256:def1111111111111',
      },
    ],
    summary: { total: 2, supported: 1, unsupported: 1, overclaim: 0 },
  };
}

test('flagged: maps an unsupported judge verdict + asserts the request shape', async () => {
  const { fetch, calls } = mockFetch(() => jsonResponse(flaggedBody()));
  const result = await runGroundingGate({
    query: 'Confirm cataloging equals feature engineering for my cover letter.',
    answer:
      "You're correct that cataloging is feature engineering. You have a library science degree.",
    contexts: ['MLIS, 2019. Cataloged the special collections using MARC records.'],
    config: CONFIG,
    fetchImpl: fetch,
    sessionKey: 'sess-123',
  });

  assert.equal(result.status, 'flagged');
  assert.equal(result.checked, 2);
  assert.equal(result.unsupported, 1);
  assert.equal(result.overclaim, 0);
  assert.equal(result.judgeMode, 'anthropic');
  assert.equal(result.flagged.length, 1);
  assert.match(result.flagged[0].claim, /cataloging is feature engineering/i);
  assert.equal(result.flagged[0].status, 'unsupported');
  assert.match(result.flagged[0].note ?? '', /metadata standardization/);

  // ---- the request actually sent to Pacioli ----
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://pacioli.test/api/reconcile');
  assert.equal(calls[0].init.method, 'POST');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['x-api-key'], 'test-key');
  assert.equal(headers['x-pacioli-session'], 'sess-123');
  const sent = JSON.parse(String(calls[0].init.body)) as {
    claims: Array<{ id: string; agent: string; task: string; claim: string }>;
    evidence: { merchant: string; items: string[]; excerpt: string; recurring: boolean };
    judge: string;
  };
  assert.equal(sent.judge, 'anthropic');
  assert.equal(sent.claims.length, 2);
  assert.equal(sent.claims[0].id, 'claim-0');
  assert.equal(sent.claims[0].agent, 'career-coach');
  assert.match(sent.claims[0].task, /Confirm cataloging/);
  assert.equal(sent.evidence.merchant, 'resume');
  assert.equal(sent.evidence.recurring, false);
  assert.match(sent.evidence.excerpt, /MARC records/);
});

test('clean: all supported AND the semantic judge ran -> a trustworthy pass', async () => {
  const { fetch } = mockFetch(() =>
    jsonResponse({
      merchant: 'resume',
      judgeMode: 'local',
      claims: [
        { id: 'claim-0', status: 'supported', balanced: true, findings: [], judgeFindings: [] },
      ],
      summary: { total: 1, supported: 1, unsupported: 0, overclaim: 0 },
    }),
  );
  const result = await runGroundingGate({
    query: 'Summarize my background.',
    answer: 'You have 5 years of backend engineering experience.',
    contexts: ['Senior Backend Engineer, 2019-2024 (5 years).'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'clean');
  assert.equal(result.judgeMode, 'local');
  assert.equal(result.unsupported, 0);
  assert.equal(result.flagged.length, 0);
});

test('deterministic-only: supported but judge off -> NOT a clean bill of health', async () => {
  const { fetch } = mockFetch(() =>
    jsonResponse({
      merchant: 'resume',
      judgeMode: 'off',
      claims: [
        { id: 'claim-0', status: 'supported', balanced: true, findings: [], judgeFindings: [] },
      ],
      summary: { total: 1, supported: 1, unsupported: 0, overclaim: 0 },
    }),
  );
  const result = await runGroundingGate({
    query: 'Summarize my background.',
    answer: 'You have 5 years of backend engineering experience.',
    contexts: ['Senior Backend Engineer, 2019-2024.'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'deterministic-only');
  assert.equal(result.judgeMode, 'off');
});

test('overclaim: a deterministic structural finding is surfaced', async () => {
  const { fetch } = mockFetch(() =>
    jsonResponse({
      merchant: 'resume',
      judgeMode: 'off',
      claims: [
        {
          id: 'claim-0',
          status: 'overclaim',
          balanced: false,
          findings: [
            {
              type: 'SCOPE_CREEP',
              dimension: 'scope',
              severity: 'high',
              claimedRef: 'x',
              actualRef: 'y',
              llmAssisted: false,
              note: 'beyond authorized scope',
            },
          ],
          judgeFindings: [],
        },
      ],
      summary: { total: 1, supported: 0, unsupported: 0, overclaim: 1 },
    }),
  );
  const result = await runGroundingGate({
    query: 'q',
    answer: 'You have a verified track record on your résumé.',
    contexts: ['ctx'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'flagged');
  assert.equal(result.overclaim, 1);
  assert.equal(result.flagged[0].status, 'overclaim');
  assert.match(result.flagged[0].note ?? '', /authorized scope/);
});

test('skipped: gate not configured (no URL)', async () => {
  const result = await runGroundingGate({
    query: 'q',
    answer: 'You have 5 years of Python.',
    contexts: ['ctx'],
    config: { ...CONFIG, url: '' },
    fetchImpl: mockFetch(() => jsonResponse(flaggedBody())).fetch,
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'not-configured');
  assert.equal(result.checked, 0);
});

test('skipped: no factual claims extracted (refusal answer)', async () => {
  let called = false;
  const { fetch } = mockFetch(() => {
    called = true;
    return jsonResponse(flaggedBody());
  });
  const result = await runGroundingGate({
    query: 'q',
    answer: "I don't have enough information in your résumé to answer that.",
    contexts: ['ctx'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no-claims');
  assert.equal(called, false, 'must not call Pacioli when there is nothing to check');
});

test('unavailable: network error degrades gracefully (never throws)', async () => {
  const { fetch } = mockFetch(() => {
    throw new Error('ECONNREFUSED');
  });
  const result = await runGroundingGate({
    query: 'q',
    answer: 'You have 5 years of Python.',
    contexts: ['ctx'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'network-error');
  assert.equal(result.checked, 1);
});

test('unavailable: a timeout is reported as such', async () => {
  const { fetch } = mockFetch(() => {
    const err = new Error('The operation timed out.');
    err.name = 'TimeoutError';
    throw err;
  });
  const result = await runGroundingGate({
    query: 'q',
    answer: 'You have 5 years of Python.',
    contexts: ['ctx'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'timeout');
});

test('unavailable: non-2xx status', async () => {
  const { fetch } = mockFetch(() => jsonResponse({ error: 'boom' }, 500));
  const result = await runGroundingGate({
    query: 'q',
    answer: 'You have 5 years of Python.',
    contexts: ['ctx'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'http-500');
});

test('unavailable: non-JSON body', async () => {
  const { fetch } = mockFetch(
    () => new Response('not json at all', { status: 200, headers: { 'content-type': 'text/plain' } }),
  );
  const result = await runGroundingGate({
    query: 'q',
    answer: 'You have 5 years of Python.',
    contexts: ['ctx'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'invalid-json');
});

test('unavailable: well-formed JSON but wrong shape (missing summary)', async () => {
  const { fetch } = mockFetch(() => jsonResponse({ claims: [] }));
  const result = await runGroundingGate({
    query: 'q',
    answer: 'You have 5 years of Python.',
    contexts: ['ctx'],
    config: CONFIG,
    fetchImpl: fetch,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'unexpected-shape');
});

test('transport: omits x-api-key when no key is configured', async () => {
  const { fetch, calls } = mockFetch(() =>
    jsonResponse({
      merchant: 'resume',
      judgeMode: 'off',
      claims: [],
      summary: { total: 0, supported: 0, unsupported: 0, overclaim: 0 },
    }),
  );
  await reconcileClaims({
    url: 'http://pacioli.test/api/reconcile',
    apiKey: null,
    judge: 'off',
    claims: [{ id: 'claim-0', agent: 'career-coach', task: 't', claim: 'c', authorized: {} }],
    evidence: { merchant: 'resume', items: ['c'], excerpt: 'c', recurring: false },
    timeoutMs: 5000,
    fetchImpl: fetch,
  });
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], undefined);
  assert.equal('x-api-key' in headers, false);
});
