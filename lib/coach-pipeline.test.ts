/**
 * Unit tests for coach-pipeline — the /api/query decision pipeline with every
 * external dependency injected (config, liveness, embeddings, pgvector RPC,
 * LLM, judge, memory, eval store, grounding). No DB, no network, no key.
 *
 * These are the route-level contract tests the extraction exists to enable:
 * the pipeline returns the exact { status, body } pairs the route serves, so
 * the honesty-gate semantics are locked here as regressions — most
 * importantly RPC-error -> 503 (the branch that used to mask a dead backend
 * as HTTP 200 "No relevant experience found.").
 *
 * Run: npx tsx --test lib/coach-pipeline.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCoachRequest,
  runCoachPipeline,
  type CoachPipelineDeps,
} from './coach-pipeline';
import { GateCounter, OOD_ABSTAIN_MESSAGE } from './quality-gates';
import { SERVICE_UNAVAILABLE_PAYLOAD } from './service-config';
import { BACKEND_UNAVAILABLE_PAYLOAD } from './backend-liveness';
import type { CoachingQualityOutput } from './evals/coaching-quality';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const GOOD_JUDGE: CoachingQualityOutput = {
  scores: { actionability: 5, personalization: 4, honesty: 5, grounding: 5 },
  reasoning: 'grounded and specific',
  overall: 88,
};

const WEAK_JUDGE: CoachingQualityOutput = {
  scores: { actionability: 2, personalization: 2, honesty: 3, grounding: 3 },
  reasoning: 'vague and unsupported',
  overall: 55,
};

const DENSE_DOCS = [
  { content: 'Led the pgvector migration for search.', similarity: 0.9 },
  { content: 'Built the eval harness for the coach.', similarity: 0.85 },
  { content: 'Shipped the LangGraph report pipeline.', similarity: 0.8 },
];

/** Call recorder + a full set of happy-path deps, individually overridable. */
function makeDeps(overrides: Partial<CoachPipelineDeps> = {}) {
  const calls = {
    embed: [] as string[],
    match: [] as Array<{ resumeId: string; matchCount: number }>,
    generate: [] as string[],
    judge: [] as string[],
    memory: [] as string[],
    summarize: [] as Array<{
      userId: string;
      sessionId: string;
      messages: Array<{ role: string; content: string }>;
    }>,
    storeEval: [] as Array<Record<string, unknown>>,
    ground: [] as Array<{ query: string; answer: string }>,
    reportDead: 0,
  };

  const deps: CoachPipelineDeps = {
    getConfig: () => ({
      openai: true,
      supabase: true,
      ready: true,
      missing: [],
    }),
    checkLiveness: async () => ({
      alive: true,
      source: 'probe',
      reason: null,
    }),
    reportBackendDead: () => {
      calls.reportDead += 1;
    },
    embedQuery: async (text) => {
      calls.embed.push(text);
      return [0.1, 0.2, 0.3];
    },
    matchDocuments: async ({ resumeId, matchCount }) => {
      calls.match.push({ resumeId, matchCount });
      return { data: DENSE_DOCS, error: null };
    },
    generate: async (prompt) => {
      calls.generate.push(prompt);
      return 'Lead with the pgvector migration story.';
    },
    judge: async ({ response }) => {
      calls.judge.push(response);
      return GOOD_JUDGE;
    },
    getMemoryContext: async (userId) => {
      calls.memory.push(userId);
      return { profile: null, recentSessions: [], formattedContext: '' };
    },
    summarizeSession: (userId, sessionId, messages) => {
      calls.summarize.push({ userId, sessionId, messages });
    },
    storeEval: async (record) => {
      calls.storeEval.push(record as unknown as Record<string, unknown>);
    },
    ground: async ({ query, answer }) => {
      calls.ground.push({ query, answer });
      return null;
    },
    gateCounter: new GateCounter(),
    newSessionId: () => 'session-fixed',
    log: { log: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };

  return { deps, calls };
}

const VALID_BODY = {
  query: 'What should I highlight for a search-infra role?',
  resumeId: 'resume-123',
};

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

test('parseCoachRequest: missing resumeId -> designed 400 reason', () => {
  const parsed = parseCoachRequest({ query: 'hi' });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error, 'resumeId required');
});

test('parseCoachRequest: empty query -> designed 400 reason (red-team ec-01)', () => {
  const parsed = parseCoachRequest({ query: '   ', resumeId: 'r1' });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error, 'query required');
});

test('parseCoachRequest: non-object body -> designed 400, never a throw', () => {
  for (const body of [null, undefined, 'text', 42, []]) {
    const parsed = parseCoachRequest(body);
    assert.equal(parsed.ok, false);
  }
});

test('parseCoachRequest: valid body -> normalized request with defaults', () => {
  const parsed = parseCoachRequest(VALID_BODY);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.request.query, VALID_BODY.query);
    assert.equal(parsed.request.resumeId, 'resume-123');
    assert.equal(parsed.request.sessionId, null);
    assert.equal(parsed.request.skipMemory, false);
    assert.equal(parsed.request.messages, null);
  }
});

test('runCoachPipeline: invalid body -> 400 with zero spend', async () => {
  const { deps, calls } = makeDeps();
  const result = await runCoachPipeline({ query: 'hi' }, deps);
  assert.equal(result.status, 400);
  assert.equal(result.kind, 'invalid-request');
  assert.equal(calls.embed.length, 0);
  assert.equal(calls.generate.length, 0);
});

// ---------------------------------------------------------------------------
// Honesty gates (config, liveness, RPC error)
// ---------------------------------------------------------------------------

test('config not ready -> 503 SERVICE_UNAVAILABLE_PAYLOAD, zero spend', async () => {
  const { deps, calls } = makeDeps({
    getConfig: () => ({
      openai: false,
      supabase: true,
      ready: false,
      missing: ['OPENAI_API_KEY'],
    }),
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, SERVICE_UNAVAILABLE_PAYLOAD);
  assert.equal(calls.embed.length, 0);
  assert.equal(calls.match.length, 0);
  assert.equal(calls.generate.length, 0);
});

test('backend dead at the cached probe -> 503 BACKEND_UNAVAILABLE_PAYLOAD before any spend', async () => {
  const { deps, calls } = makeDeps({
    checkLiveness: async () => ({
      alive: false,
      source: 'cache',
      reason: 'probe-failed',
    }),
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, BACKEND_UNAVAILABLE_PAYLOAD);
  assert.equal(calls.embed.length, 0);
  assert.equal(calls.generate.length, 0);
});

test('REGRESSION LOCK: retrieval RPC error -> 503, never a 200 canned answer', async () => {
  // This is the masked-failure branch the honesty gate fixed: a dead backend
  // used to come back HTTP 200 {answer: "No relevant experience found."}.
  // The pipeline must return the designed 503 and flip the liveness cache.
  const { deps, calls } = makeDeps({
    matchDocuments: async () => ({
      data: null,
      error: { message: 'connection refused' },
    }),
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 503);
  assert.notEqual(result.status, 200);
  assert.deepEqual(result.body, BACKEND_UNAVAILABLE_PAYLOAD);
  assert.ok(
    !JSON.stringify(result.body).includes('No relevant experience found'),
    'a backend failure must never be dressed up as an honest empty retrieval',
  );
  assert.equal(calls.reportDead, 1, 'must flip the shared liveness cache');
  assert.equal(calls.generate.length, 0, 'no LLM spend after a dead backend');
});

// ---------------------------------------------------------------------------
// Honest empty retrieval and OOD abstention (the designed non-answers)
// ---------------------------------------------------------------------------

test('genuinely empty retrieval -> 200 honest empty answer with signals', async () => {
  const { deps, calls } = makeDeps({
    matchDocuments: async () => ({ data: [], error: null }),
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 200);
  assert.equal(result.kind, 'answered');
  if (result.kind !== 'answered') return;
  assert.equal(result.body.answer, 'No relevant experience found.');
  assert.deepEqual(result.body.sources, []);
  assert.equal(result.body.scores, null);
  assert.ok(result.body.signals, 'honest empty still carries signals');
  assert.equal(result.body.signals.ood, null);
  assert.equal(calls.generate.length, 0, 'no grounding -> no generation');
  assert.equal(calls.reportDead, 0, 'an honest empty is NOT a dead backend');
});

test('OOD query -> abstains BEFORE generation with the calibrated message', async () => {
  const { deps, calls } = makeDeps({
    matchDocuments: async () => ({
      data: [
        { content: 'quantum chromodynamics notes', similarity: 0.05 },
        { content: 'unrelated trivia', similarity: 0.03 },
      ],
      error: null,
    }),
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 200);
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.equal(result.body.answer, OOD_ABSTAIN_MESSAGE);
  assert.equal(result.body.signals.ood?.abstained, true);
  assert.equal(result.body.signals.hitl.routeToHuman, false);
  assert.deepEqual(result.body.signals.hitl.triggers, ['off-resume-ood']);
  assert.equal(calls.generate.length, 0, 'abstention must precede the LLM');
  assert.equal(calls.judge.length, 0);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('happy path -> 200 answer with sources, scores, signals, eval write, grounding', async () => {
  const { deps, calls } = makeDeps();
  const result = await runCoachPipeline(
    { ...VALID_BODY, sessionId: 'session-abc' },
    deps,
  );
  assert.equal(result.status, 200);
  if (result.kind !== 'answered') assert.fail('expected an answered result');

  assert.equal(result.body.answer, 'Lead with the pgvector migration story.');
  assert.equal(result.body.sessionId, 'session-abc');
  assert.equal(result.body.sources.length, DENSE_DOCS.length);
  assert.deepEqual(result.body.scores, {
    overall: GOOD_JUDGE.overall,
    actionability: GOOD_JUDGE.scores.actionability,
    personalization: GOOD_JUDGE.scores.personalization,
    honesty: GOOD_JUDGE.scores.honesty,
    grounding: GOOD_JUDGE.scores.grounding,
  });

  // One generation + one judge call: the answer satisficed on iteration 1.
  assert.equal(calls.generate.length, 1);
  assert.equal(calls.judge.length, 1);
  assert.equal(result.body.signals.satisficing?.iterations, 1);
  assert.equal(result.body.signals.satisficing?.meetsQualityBar, true);

  // Dense docs, no high-stakes keyword -> no HITL escalation.
  assert.equal(result.body.signals.hitl.routeToHuman, false);
  assert.equal(result.body.signals.confidence, 1);

  // The judge result is persisted best-effort and grounding was consulted.
  assert.equal(calls.storeEval.length, 1);
  assert.equal(calls.ground.length, 1);

  // Cascade telemetry carries both the calibrated replay and the live tally.
  assert.ok(result.body.signals.cascade);
  assert.ok(result.body.signals.cascade.live);
  assert.ok(result.body.signals.cascade.measured);
});

test('missing sessionId -> a fresh one is issued and echoed', async () => {
  const { deps } = makeDeps();
  const result = await runCoachPipeline(VALID_BODY, deps);
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.equal(result.body.sessionId, 'session-fixed');
});

test('weak first draft -> revision pass runs and reports its iterations', async () => {
  let judgeCall = 0;
  const { deps, calls } = makeDeps({
    judge: async () => {
      judgeCall += 1;
      return judgeCall === 1 ? WEAK_JUDGE : GOOD_JUDGE;
    },
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.equal(calls.generate.length, 2, 'weak draft must trigger a revision');
  assert.ok(
    calls.generate[1].includes('REVISION PASS'),
    'revision prompt carries the judge feedback',
  );
  assert.equal(result.body.signals.satisficing?.iterations, 2);
  assert.equal(result.body.signals.satisficing?.meetsQualityBar, true);
});

test('high-stakes keyword -> HITL escalation trigger in signals', async () => {
  const { deps } = makeDeps();
  const result = await runCoachPipeline(
    { ...VALID_BODY, query: 'Should I resign before the review cycle?' },
    deps,
  );
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.equal(result.body.signals.hitl.routeToHuman, true);
  assert.ok(
    result.body.signals.hitl.triggers.includes('high-stakes-keyword'),
  );
});

// ---------------------------------------------------------------------------
// Degradation: judge, eval store, grounding must never break the answer
// ---------------------------------------------------------------------------

test('judge failure -> falls back to a single generation, scores null', async () => {
  const { deps, calls } = makeDeps({
    judge: async () => {
      throw new Error('judge model unavailable');
    },
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 200);
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.equal(result.body.scores, null);
  assert.equal(result.body.signals.satisficing, null);
  assert.ok(result.body.answer.length > 0);
  assert.equal(calls.storeEval.length, 0, 'no judge result -> nothing to store');
});

test('eval-store failure -> the answer still returns 200', async () => {
  const { deps } = makeDeps({
    storeEval: async () => {
      throw new Error('evals table missing');
    },
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 200);
});

test('grounding gate throwing -> answer survives with grounding null', async () => {
  const { deps } = makeDeps({
    ground: async () => {
      throw new Error('wiring bug');
    },
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.equal(result.body.signals.grounding, null);
});

test('grounding flags the answer -> HITL escalates with grounding-unsupported', async () => {
  const { deps } = makeDeps({
    ground: async () => ({
      status: 'flagged' as const,
      checked: 3,
      unsupported: 1,
      overclaim: 0,
      judgeMode: 'semantic',
      flagged: [],
      reason: null,
    }),
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.equal(result.body.signals.hitl.routeToHuman, true);
  assert.ok(
    result.body.signals.hitl.triggers.includes('grounding-unsupported'),
  );
});

// ---------------------------------------------------------------------------
// Eval-run semantics (skipMemory) — the benchmark contract
// ---------------------------------------------------------------------------

test('skipMemory: no memory reads or writes, single generation, no expansion', async () => {
  const { deps, calls } = makeDeps({
    judge: async () => WEAK_JUDGE, // even a weak draft must NOT revise
  });
  const result = await runCoachPipeline(
    { ...VALID_BODY, skipMemory: true },
    deps,
  );
  assert.equal(result.status, 200);
  assert.equal(calls.memory.length, 0);
  assert.equal(calls.summarize.length, 0);
  assert.equal(
    calls.generate.length,
    1,
    'benchmark runs measure the raw first draft',
  );
});

// ---------------------------------------------------------------------------
// Memory scoping — safe by DEFAULT.
//
// The red-team (2026-05-11, finding #3) traced a cross-conversation memory
// leak to userId = resumeId aliasing: session summaries written under one
// conversation were read back into unrelated later conversations that shared
// the resumeId ("the anxiety you mentioned" surfacing two prompts later in a
// different context). The fix used to be OPT-IN (skipMemory: true); these
// tests lock the safe default instead: memory is scoped to the conversation
// (resumeId + sessionId) unless the caller EXPLICITLY claims a stable
// identity via userId.
// ---------------------------------------------------------------------------

test('parseCoachRequest: optional userId is normalized (string kept, junk -> null)', () => {
  const withUser = parseCoachRequest({ ...VALID_BODY, userId: 'u-42' });
  assert.equal(withUser.ok, true);
  if (withUser.ok) assert.equal(withUser.request.userId, 'u-42');

  for (const userId of [undefined, null, '', 42, {}, []]) {
    const parsed = parseCoachRequest({ ...VALID_BODY, userId });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.request.userId, null);
  }
});

test('REGRESSION LOCK (red-team #3): default memory scope is the conversation, never bare resumeId', async () => {
  const { deps, calls } = makeDeps();
  await runCoachPipeline({ ...VALID_BODY, sessionId: 's1' }, deps);
  assert.deepEqual(calls.memory, ['session:resume-123:s1']);
  assert.equal(calls.summarize.length, 1);
  assert.equal(calls.summarize[0].userId, 'session:resume-123:s1');
  assert.ok(
    !calls.memory.includes('resume-123'),
    'the bare resumeId memory key is the leak class and must never be used',
  );
});

test('default scoping: two conversations on the same resume share NO memory key', async () => {
  const first = makeDeps();
  await runCoachPipeline({ ...VALID_BODY, sessionId: 'conv-a' }, first.deps);
  const second = makeDeps();
  await runCoachPipeline({ ...VALID_BODY, sessionId: 'conv-b' }, second.deps);
  assert.notEqual(first.calls.memory[0], second.calls.memory[0]);
  assert.notEqual(
    first.calls.summarize[0].userId,
    second.calls.summarize[0].userId,
  );
});

test('fresh conversation (no sessionId) scopes memory to the minted session id', async () => {
  const { deps, calls } = makeDeps();
  const result = await runCoachPipeline(VALID_BODY, deps);
  if (result.kind !== 'answered') assert.fail('expected an answered result');
  assert.deepEqual(calls.memory, ['session:resume-123:session-fixed']);
  assert.equal(calls.summarize[0].userId, 'session:resume-123:session-fixed');
  assert.equal(result.body.sessionId, 'session-fixed');
});

test('explicit userId: cross-session memory is an EXPLICIT claim, namespaced apart from session scope', async () => {
  const { deps, calls } = makeDeps();
  await runCoachPipeline(
    { ...VALID_BODY, sessionId: 's1', userId: 'u-42' },
    deps,
  );
  assert.deepEqual(calls.memory, ['user:u-42']);
  assert.equal(calls.summarize[0].userId, 'user:u-42');
});

test('memory read failure degrades to stateless, not an error', async () => {
  const { deps } = makeDeps({
    getMemoryContext: async () => {
      throw new Error('memory backend down');
    },
  });
  const result = await runCoachPipeline(VALID_BODY, deps);
  assert.equal(result.status, 200);
});

test('session summarization includes the current exchange', async () => {
  const { deps, calls } = makeDeps();
  await runCoachPipeline(
    {
      ...VALID_BODY,
      messages: [{ role: 'user', content: 'earlier turn' }],
    },
    deps,
  );
  assert.equal(calls.summarize.length, 1);
  const summarized = calls.summarize[0].messages;
  assert.equal(summarized[0].content, 'earlier turn');
  assert.equal(summarized[summarized.length - 2].content, VALID_BODY.query);
  assert.equal(
    summarized[summarized.length - 1].content,
    'Lead with the pgvector migration story.',
  );
});
