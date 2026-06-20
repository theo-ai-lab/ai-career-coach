/**
 * Unit tests for quality-gates/info-gain.
 * Mock vectors / mock Embedder only — no DB, no key.
 * Run: npx tsx --test lib/quality-gates/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  semanticDrift,
  contentTokens,
  lexicalNovelty,
  decideReretrieval,
  decideReretrievalForQueries,
  type Embedder,
} from './info-gain';

test('semanticDrift: identical query -> ~0 drift', () => {
  assert.ok(Math.abs(semanticDrift([1, 0, 0], [2, 0, 0])) < 1e-12);
});

test('semanticDrift: orthogonal -> 1', () => {
  assert.ok(Math.abs(semanticDrift([1, 0], [0, 1]) - 1) < 1e-12);
});

test('contentTokens strips stopwords and short tokens', () => {
  const t = contentTokens('How do I improve my Kubernetes scaling?');
  assert.equal(t.has('kubernetes'), true);
  assert.equal(t.has('scaling'), true);
  assert.equal(t.has('improve'), true);
  // stopwords removed
  assert.equal(t.has('how'), false);
  assert.equal(t.has('do'), false);
  assert.equal(t.has('my'), false);
});

test('lexicalNovelty: fully-covered query -> 0', () => {
  const prior = 'kubernetes scaling autoscaler nodes';
  const novelty = lexicalNovelty(prior, 'kubernetes scaling');
  assert.equal(novelty, 0);
});

test('lexicalNovelty: all-new content -> 1', () => {
  const novelty = lexicalNovelty('cooking recipes pasta', 'kubernetes terraform');
  assert.equal(novelty, 1);
});

test('lexicalNovelty: half-new content -> 0.5', () => {
  // new content tokens: {kubernetes, terraform}; prior has kubernetes
  const novelty = lexicalNovelty('kubernetes scaling', 'kubernetes terraform');
  assert.ok(Math.abs(novelty - 0.5) < 1e-9);
});

test('lexicalNovelty: empty new query -> 0', () => {
  assert.equal(lexicalNovelty('anything here', '   '), 0);
});

test('decideReretrieval: low drift + low novelty -> reuse (saves a call)', () => {
  const d = decideReretrieval(0.05, 0.0);
  assert.equal(d.reretrieve, false);
  assert.equal(d.savedRetrievalCall, true);
  assert.match(d.reason, /reusing prior/);
});

test('decideReretrieval: high drift -> re-retrieve', () => {
  const d = decideReretrieval(0.9, 0.0);
  assert.equal(d.reretrieve, true);
  assert.equal(d.savedRetrievalCall, false);
});

test('decideReretrieval: high novelty -> re-retrieve even at low drift', () => {
  const d = decideReretrieval(0.0, 1.0);
  assert.equal(d.reretrieve, true);
});

test('decideReretrieval: critique requiresMoreEvidence forces re-retrieve', () => {
  const d = decideReretrieval(0.0, 0.0, {
    requiresMoreEvidence: true,
    missingInfo: ['quantified impact metrics'],
  });
  assert.equal(d.reretrieve, true);
  assert.equal(d.savedRetrievalCall, false);
  assert.match(d.reason, /requiresMoreEvidence/);
});

test('decideReretrieval: combined score at exact threshold re-retrieves', () => {
  // default weights drift 0.6 / novelty 0.4, threshold 0.25.
  // drift 0.25, novelty 0.25 -> infoGain 0.25 == threshold (>=) -> true
  const d = decideReretrieval(0.25, 0.25);
  assert.ok(Math.abs(d.infoGain - 0.25) < 1e-9);
  assert.equal(d.reretrieve, true);
});

test('decideReretrieval: custom threshold flips decision', () => {
  const reuse = decideReretrieval(0.4, 0.4, undefined, { reretrieveThreshold: 0.9 });
  assert.equal(reuse.reretrieve, false);
  const fire = decideReretrieval(0.1, 0.1, undefined, { reretrieveThreshold: 0.05 });
  assert.equal(fire.reretrieve, true);
});

test('decideReretrieval: drift clamps into [0,1] for the blend', () => {
  // opposing vectors give drift up to 2; it must clamp, not over-weight.
  const d = decideReretrieval(2.0, 0.0);
  assert.ok(d.infoGain <= 1);
  // 0.6 * 1 + 0.4 * 0 = 0.6
  assert.ok(Math.abs(d.infoGain - 0.6) < 1e-9);
});

test('invalid weights throw', () => {
  assert.throws(
    () => decideReretrieval(0.5, 0.5, undefined, { driftWeight: 0, noveltyWeight: 0 }),
    /must be > 0/,
  );
});

test('decideReretrievalForQueries uses an injectable mock embedder', async () => {
  // Mock embedder: maps a couple of known queries to fixed vectors.
  const vectors: Record<string, number[]> = {
    'improve my resume': [1, 0, 0],
    'tighten resume wording': [0.99, 0.1, 0], // near-identical direction
    'kubernetes cost optimization': [0, 1, 0], // orthogonal -> high drift
  };
  const mockEmbedder: Embedder = {
    async embedQuery(text) {
      const v = vectors[text];
      if (!v) throw new Error(`unexpected query in test: ${text}`);
      return v;
    },
  };

  // Near-identical refinement + no new tokens beyond prior context -> reuse.
  const reuse = await decideReretrievalForQueries(
    'improve my resume',
    'tighten resume wording',
    'resume wording bullet points tighten improve', // prior context covers the new tokens
    mockEmbedder,
  );
  assert.equal(reuse.reretrieve, false);
  assert.equal(reuse.savedRetrievalCall, true);

  // Orthogonal refinement -> high drift -> re-retrieve.
  const fire = await decideReretrievalForQueries(
    'improve my resume',
    'kubernetes cost optimization',
    'resume wording bullet points',
    mockEmbedder,
  );
  assert.equal(fire.reretrieve, true);
});
