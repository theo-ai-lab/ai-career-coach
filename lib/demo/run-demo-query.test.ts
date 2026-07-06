/**
 * End-to-end tests for the keyless demo answer path (runDemoQuery), locking
 * each scripted /demo query to its intended gate outcome. Everything here
 * runs the REAL gate code (decideOOD, retrieval pipeline, routeForHitl) over
 * the committed demo space — no DB, no key, no network, no mocks.
 * Run: npx tsx --test lib/demo/run-demo-query.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runDemoQuery,
  DEMO_GENERATION_NOTES,
  DEMO_MATCH_COUNT,
} from './run-demo-query';
import {
  SCRIPTED_DEMO_QUERIES,
  matchScriptedQuery,
  DEMO_MODE_LABEL,
} from './scripted-queries';
import { OOD_ABSTAIN_MESSAGE } from '@/lib/quality-gates';
import demoCorpus from './demo-corpus.json';

function scripted(id: string) {
  const s = SCRIPTED_DEMO_QUERIES.find((x) => x.id === id);
  assert.ok(s, `scripted query ${id} missing`);
  return s;
}

test('scripted grounded query answers with its canned completion, all gates pass', async () => {
  const res = await runDemoQuery(scripted('demo-grounded').query);
  assert.equal(res.demo.generation, 'canned');
  assert.equal(res.demo.label, DEMO_MODE_LABEL);
  assert.equal(res.demo.scriptedQueryId, 'demo-grounded');
  assert.equal(res.answer, scripted('demo-grounded').cannedAnswer);
  assert.equal(res.signals.ood.abstained, false);
  assert.equal(res.signals.hitl.routeToHuman, false);
  // Sources are real committed demo chunks with real cosine similarities.
  assert.equal(res.sources.length, DEMO_MATCH_COUNT);
  const corpusTexts = new Set(demoCorpus.chunks.map((c) => c.content));
  for (const s of res.sources) {
    assert.ok(corpusTexts.has(s.content), 'source not from the demo corpus');
    assert.ok(s.similarity >= -1 && s.similarity <= 1);
  }
  // No judge, no satisficing loop, no grounding peer in demo mode: all
  // honestly null rather than faked.
  assert.equal(res.scores, null);
  assert.equal(res.signals.satisficing, null);
  assert.equal(res.signals.grounding, null);
});

test('scripted off-résumé query abstains BEFORE generation with the production message', async () => {
  const res = await runDemoQuery(scripted('demo-ood').query);
  assert.equal(res.demo.generation, 'gate-abstention');
  assert.equal(res.answer, OOD_ABSTAIN_MESSAGE);
  assert.equal(res.signals.ood.abstained, true);
  assert.ok(res.signals.ood.threshold !== null);
  assert.ok(res.signals.ood.score > res.signals.ood.threshold);
  assert.deepEqual(res.sources, []);
  assert.deepEqual(res.signals.hitl.triggers, ['off-resume-ood']);
  assert.equal(res.signals.hitl.routeToHuman, false);
});

test('scripted high-stakes query answers but routes to human review', async () => {
  const res = await runDemoQuery(scripted('demo-hitl').query);
  assert.equal(res.demo.generation, 'canned');
  assert.equal(res.signals.ood.abstained, false);
  assert.equal(res.signals.hitl.routeToHuman, true);
  assert.ok(res.signals.hitl.triggers.includes('high-stakes-keyword'));
  assert.equal(res.answer, scripted('demo-hitl').cannedAnswer);
});

test('every scripted query has a distinct query text and matches itself', () => {
  const ids = new Set(SCRIPTED_DEMO_QUERIES.map((s) => s.id));
  assert.equal(ids.size, SCRIPTED_DEMO_QUERIES.length);
  for (const s of SCRIPTED_DEMO_QUERIES) {
    assert.equal(matchScriptedQuery(s.query)?.id, s.id);
    // Matching is whitespace/case-insensitive (chip clicks and hand-typing).
    assert.equal(matchScriptedQuery(`  ${s.query.toUpperCase()}  `)?.id, s.id);
  }
  assert.equal(matchScriptedQuery('something else entirely'), null);
});

test('a free-typed on-corpus query gets the labeled extractive fallback, not a fake generation', async () => {
  const res = await runDemoQuery('Tell me about my library and metadata work');
  assert.equal(res.demo.generation, 'extractive');
  assert.equal(res.demo.scriptedQueryId, null);
  assert.equal(res.demo.generationNote, DEMO_GENERATION_NOTES.extractive);
  // The fallback says outright there is no model, and quotes real chunks.
  assert.match(res.answer, /no generation model/);
  const corpusJoined = demoCorpus.chunks.map((c) => c.content).join('\n');
  for (const quoted of res.answer.match(/^> (.+)$/gm) ?? []) {
    const text = quoted.slice(2).trim();
    assert.ok(
      corpusJoined.replace(/\n+/g, ' ').includes(text),
      'extractive excerpt not verbatim from the demo corpus',
    );
  }
});

test('a query sharing no vocabulary with the corpus abstains at the space ceiling', async () => {
  const res = await runDemoQuery('zzz qqq xyzzy plugh');
  assert.equal(res.signals.ood.abstained, true);
  assert.equal(res.signals.ood.score, 1);
});

test('demo provenance labels are carried on every response shape', async () => {
  for (const s of SCRIPTED_DEMO_QUERIES) {
    const res = await runDemoQuery(s.query);
    assert.equal(res.demo.label, DEMO_MODE_LABEL);
    assert.match(res.demo.corpus, /fictional/i);
    assert.match(res.demo.embeddings, /not model embeddings/i);
    assert.equal(res.demo.generationNote, DEMO_GENERATION_NOTES[res.demo.generation]);
  }
});

test('demo turns are deterministic: same query, same decisions and text', async () => {
  const q = scripted('demo-grounded').query;
  const a = await runDemoQuery(q);
  const b = await runDemoQuery(q);
  assert.deepEqual(a, b);
});
