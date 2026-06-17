/**
 * Unit tests for quality-gates/data-density.
 * Mock vectors / mock NeighborProbe only — no DB, no key.
 * Run: npx tsx --test lib/quality-gates/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateDensityFromNeighborSimilarities,
  estimateDensityFromVectors,
  assessQueryDensity,
  routeForHitl,
  DEFAULT_DENSITY_CONFIG,
  type NeighborProbe,
} from './data-density';

test('dense region -> high confidence, no HITL', () => {
  const a = estimateDensityFromNeighborSimilarities([0.9, 0.85, 0.8, 0.75, 0.7]);
  assert.equal(a.region, 'dense');
  assert.equal(a.confidence, 1);
  assert.equal(a.routeToHITL, false);
});

test('sparse region -> floored confidence, routes to HITL', () => {
  const a = estimateDensityFromNeighborSimilarities([0.2, 0.15, 0.1, 0.05, 0.0]);
  assert.equal(a.region, 'sparse');
  assert.equal(a.confidence, 0);
  assert.equal(a.routeToHITL, true);
  assert.match(a.reason, /SPARSE/);
});

test('borderline region -> scaled confidence in (0,1), no HITL', () => {
  // mean of these is 0.45, between sparse floor 0.30 and dense ceil 0.60
  const a = estimateDensityFromNeighborSimilarities([0.45, 0.45, 0.45, 0.45, 0.45]);
  assert.equal(a.region, 'borderline');
  assert.ok(a.confidence > 0 && a.confidence < 1);
  // (0.45 - 0.30) / (0.60 - 0.30) = 0.5
  assert.ok(Math.abs(a.confidence - 0.5) < 1e-9);
  assert.equal(a.routeToHITL, false);
});

test('empty neighbours -> maximally sparse, always HITL', () => {
  const a = estimateDensityFromNeighborSimilarities([]);
  assert.equal(a.neighborsUsed, 0);
  assert.equal(a.confidence, 0);
  assert.equal(a.region, 'sparse');
  assert.equal(a.routeToHITL, true);
});

test('only the top-k similarities are averaged', () => {
  // k=5 default; the trailing tiny values must be ignored.
  const sims = [0.9, 0.9, 0.9, 0.9, 0.9, 0.0, 0.0, 0.0];
  const a = estimateDensityFromNeighborSimilarities(sims);
  assert.equal(a.neighborsUsed, 5);
  assert.ok(Math.abs(a.meanNeighborSimilarity - 0.9) < 1e-9);
  assert.equal(a.region, 'dense');
});

test('estimateDensityFromVectors computes kNN in-module (mock vectors)', () => {
  const query = [1, 0];
  // 5 near-aligned vectors (dense) + noise
  const denseCorpus = [
    [1, 0],
    [0.98, 0.02],
    [0.97, 0.05],
    [0.95, 0.1],
    [0.93, 0.12],
    [0, 1],
  ];
  const dense = estimateDensityFromVectors(query, denseCorpus, { k: 5 });
  assert.equal(dense.region, 'dense');
  assert.equal(dense.routeToHITL, false);

  // Orthogonal/opposed corpus -> sparse
  const farCorpus = [
    [0, 1],
    [0, -1],
    [-1, 0],
    [-0.9, 0.3],
  ];
  const sparse = estimateDensityFromVectors(query, farCorpus, { k: 5 });
  assert.equal(sparse.region, 'sparse');
  assert.equal(sparse.routeToHITL, true);
});

test('estimateDensityFromVectors: empty corpus -> sparse/HITL', () => {
  const a = estimateDensityFromVectors([1, 0], [], { k: 5 });
  assert.equal(a.region, 'sparse');
  assert.equal(a.routeToHITL, true);
});

test('invalid config (sparse >= dense) throws', () => {
  assert.throws(
    () => estimateDensityFromNeighborSimilarities([0.5], { sparseSimilarity: 0.7, denseSimilarity: 0.6 }),
    /must be </,
  );
});

test('custom thresholds change classification', () => {
  // With a stricter dense ceiling, 0.5 mean is no longer dense.
  const a = estimateDensityFromNeighborSimilarities([0.5, 0.5, 0.5], {
    sparseSimilarity: 0.1,
    denseSimilarity: 0.9,
  });
  assert.equal(a.region, 'borderline');
});

test('assessQueryDensity uses an injectable mock probe', async () => {
  const mockProbe: NeighborProbe = {
    async nearestSimilarities(_q, k) {
      assert.equal(k, DEFAULT_DENSITY_CONFIG.k);
      return [0.1, 0.1, 0.1, 0.1, 0.1];
    },
  };
  const a = await assessQueryDensity([0.1, 0.2, 0.3], mockProbe);
  assert.equal(a.region, 'sparse');
  assert.equal(a.routeToHITL, true);
});

test('routeForHitl: sparse density alone escalates', () => {
  const density = estimateDensityFromNeighborSimilarities([0.1, 0.1, 0.1]);
  const d = routeForHitl(density, false);
  assert.equal(d.routeToHuman, true);
  assert.deepEqual(d.triggers, ['sparse-data-density']);
});

test('routeForHitl: keyword alone escalates even when dense', () => {
  const density = estimateDensityFromNeighborSimilarities([0.9, 0.9, 0.9]);
  const d = routeForHitl(density, true);
  assert.equal(d.routeToHuman, true);
  assert.deepEqual(d.triggers, ['high-stakes-keyword']);
  assert.equal(d.confidence, 1);
});

test('routeForHitl: both signals -> both triggers listed', () => {
  const density = estimateDensityFromNeighborSimilarities([0.1, 0.1, 0.1]);
  const d = routeForHitl(density, true);
  assert.deepEqual(d.triggers, ['sparse-data-density', 'high-stakes-keyword']);
});

test('routeForHitl: dense + no keyword -> no escalation', () => {
  const density = estimateDensityFromNeighborSimilarities([0.9, 0.9, 0.9]);
  const d = routeForHitl(density, false);
  assert.equal(d.routeToHuman, false);
  assert.equal(d.triggers.length, 0);
});
