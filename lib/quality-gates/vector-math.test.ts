/**
 * Unit tests for quality-gates/vector-math.
 * Run: npx tsx --test lib/quality-gates/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dot,
  norm,
  cosineSimilarity,
  cosineDistance,
  similaritiesTo,
  kNearestSimilarities,
  mean,
  clamp,
} from './vector-math';

test('dot: basic and mismatch', () => {
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
  assert.throws(() => dot([1, 2], [1, 2, 3]), /dimension mismatch/);
});

test('norm', () => {
  assert.equal(norm([3, 4]), 5);
  assert.equal(norm([0, 0]), 0);
});

test('cosineSimilarity: identical, orthogonal, opposite', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 1], [2, 2]) - 1) < 1e-12);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-12);
});

test('cosineSimilarity: zero vector -> 0 (no NaN)', () => {
  const s = cosineSimilarity([0, 0], [1, 2]);
  assert.equal(s, 0);
  assert.equal(Number.isNaN(s), false);
});

test('cosineDistance complements similarity', () => {
  assert.ok(Math.abs(cosineDistance([1, 0], [1, 0])) < 1e-12);
  assert.equal(cosineDistance([1, 0], [0, 1]), 1);
});

test('similaritiesTo sorts descending', () => {
  const q = [1, 0];
  const corpus = [
    [0, 1], // sim 0
    [1, 0], // sim 1
    [1, 1], // sim ~0.707
  ];
  const sims = similaritiesTo(q, corpus);
  assert.equal(sims.length, 3);
  // sorted desc
  for (let i = 1; i < sims.length; i++) {
    assert.ok(sims[i - 1] >= sims[i]);
  }
  assert.ok(Math.abs(sims[0] - 1) < 1e-12);
});

test('kNearestSimilarities respects k and validates k', () => {
  const q = [1, 0];
  const corpus = [
    [1, 0],
    [0.9, 0.1],
    [0, 1],
    [-1, 0],
  ];
  const top2 = kNearestSimilarities(q, corpus, 2);
  assert.equal(top2.length, 2);
  assert.ok(top2[0] >= top2[1]);
  // k larger than corpus returns all
  assert.equal(kNearestSimilarities(q, corpus, 99).length, 4);
  assert.throws(() => kNearestSimilarities(q, corpus, 0), /positive integer/);
  assert.throws(() => kNearestSimilarities(q, corpus, 1.5), /positive integer/);
});

test('mean and clamp', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([]), 0);
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});
