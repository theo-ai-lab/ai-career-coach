/**
 * Offline tests for the pre-generation OOD gate + its conformal primitives.
 * Plain `number[]` similarity profiles only — no DB, no key, no LLM.
 * Run: npx tsx --test lib/quality-gates/ood-gate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreOOD,
  conformalQuantileRank,
  splitConformalThreshold,
  wilsonInterval,
  OOD_SCORE_WEIGHTS,
} from './ood-score';
import { mulberry32, seededShuffle } from './ood-score';
import {
  decideOOD,
  loadOODCalibration,
  OOD_ABSTAIN_MESSAGE,
  type OODCalibration,
} from './ood-gate';

// Representative REAL profiles from the committed red-team run
// (data/eval-benchmark/red-team-raw-results.json), descending similarities.
const POKEMON = [0.146, 0.092, 0.073, 0.073, 0.043, -0.013]; // ec-02 (off-résumé)
const LEXAPRO = [0.117, 0.116, 0.109, 0.087, 0.081, 0.035]; // cg-03 (off-résumé)
const LIBRARY_REF = [0.49, 0.432, 0.399, 0.338, 0.312, 0.241]; // mr-03 (on-résumé)
const MLIS = [0.476, 0.352, 0.316, 0.287, 0.273, 0.176]; // ut-04 (on-résumé)

test('scoreOOD: empty profile is maximally surprising', () => {
  const s = scoreOOD([]);
  assert.equal(s.coverage, 0);
  assert.equal(s.centroidProximity, 0);
  assert.equal(s.score, 1);
});

test('scoreOOD: order-independent and uses 0.6/0.4 weights', () => {
  const a = scoreOOD([0.4, 0.2]);
  const b = scoreOOD([0.2, 0.4]);
  assert.deepEqual(a, b);
  // coverage 0.4, centroidProximity 0.3 -> support = .6*.4 + .4*.3 = .36
  assert.ok(Math.abs(a.support - 0.36) < 1e-9);
  assert.ok(Math.abs(a.score - 0.64) < 1e-9);
  assert.deepEqual(OOD_SCORE_WEIGHTS, { coverage: 0.6, centroidProximity: 0.4 });
});

test('scoreOOD: lower similarities => strictly higher OOD score', () => {
  assert.ok(scoreOOD(POKEMON).score > scoreOOD(LIBRARY_REF).score);
  assert.ok(scoreOOD(LEXAPRO).score > scoreOOD(MLIS).score);
});

test('scoreOOD: negative similarities are clamped, never NaN', () => {
  const s = scoreOOD([-0.5, -0.9]);
  assert.ok(Number.isFinite(s.score));
  assert.equal(s.coverage, 0); // max(-0.5,-0.9)=-0.5 clamped to 0
  assert.equal(s.score, 1);
});

test('scoreOOD: margin is a clamped diagnostic, single-element safe', () => {
  const single = scoreOOD([0.4]);
  assert.equal(single.margin, single.coverage); // no "rest" -> margin == coverage
  const peaked = scoreOOD([0.9, 0.1, 0.1]);
  assert.ok(peaked.margin > 0 && peaked.margin <= 1);
});

test('conformalQuantileRank: finite-sample-corrected order statistic', () => {
  // ceil((n+1)(1-alpha))
  assert.equal(conformalQuantileRank(24, 0.15), 22);
  assert.equal(conformalQuantileRank(10, 0.5), 6);
  // n too small to certify alpha -> null (rank would exceed n)
  assert.equal(conformalQuantileRank(5, 0.1), null);
  assert.throws(() => conformalQuantileRank(0, 0.1), /positive integer/);
  assert.throws(() => conformalQuantileRank(10, 0), /\(0,1\)/);
  assert.throws(() => conformalQuantileRank(10, 1), /\(0,1\)/);
});

test('splitConformalThreshold: picks the right order statistic; Infinity when uncertifiable', () => {
  const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]; // n=10
  // alpha=0.5 -> rank 6 -> 6th smallest = 0.6
  assert.ok(Math.abs(splitConformalThreshold(scores, 0.5) - 0.6) < 1e-9);
  // n=5, alpha=0.1 -> uncertifiable -> Infinity (never abstain)
  assert.equal(splitConformalThreshold([0.1, 0.2, 0.3, 0.4, 0.5], 0.1), Infinity);
});

test('wilsonInterval: honest small-n proportion CI', () => {
  const zero = wilsonInterval(0, 10);
  assert.equal(zero.low, 0);
  assert.ok(zero.high > 0 && zero.high < 0.4); // not a degenerate [0,0]
  const half = wilsonInterval(5, 10);
  assert.ok(Math.abs((half.low + half.high) / 2 - 0.5) < 1e-9); // symmetric
  const empty = wilsonInterval(0, 0);
  assert.deepEqual(empty, { low: 0, high: 1 });
});

test('mulberry32 + seededShuffle are deterministic and total', () => {
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  assert.equal(r1(), r2());
  const items = [0, 1, 2, 3, 4, 5, 6, 7];
  const a = seededShuffle(items, 7);
  const b = seededShuffle(items, 7);
  assert.deepEqual(a, b); // same seed -> same order
  assert.deepEqual([...a].sort((x, y) => x - y), items); // a permutation
  assert.notDeepEqual(seededShuffle(items, 7), seededShuffle(items, 8));
});

// ---- decision logic (injected calibration => independent of the artifact) ----

const FIXED: OODCalibration = {
  schemaVersion: 1,
  generatedFrom: 'test',
  scoreWeights: { coverage: 0.6, centroidProximity: 0.4 },
  targetAbstainRate: 0.15,
  n: 10,
  conformalRank: 9,
  threshold: 0.5,
  realizedAbstainRate: 0.1,
};

test('decideOOD: strict threshold (score > tau abstains)', () => {
  // support 0.36 -> score 0.64 > 0.5 -> abstain
  const hi = decideOOD([0.4, 0.2], FIXED);
  assert.equal(hi.abstain, true);
  assert.match(hi.reason, /OFF-résumé/);
  // support 0.6 -> score 0.4 <= 0.5 -> pass
  const lo = decideOOD([0.6, 0.6], FIXED);
  assert.equal(lo.abstain, false);
  assert.match(lo.reason, /within résumé support/);
});

test('decideOOD: null threshold => never abstain (no guessed cutoff)', () => {
  const noThresh: OODCalibration = { ...FIXED, threshold: null, conformalRank: null };
  const d = decideOOD([], noThresh); // even a maximally-OOD empty profile
  assert.equal(d.abstain, false);
  assert.equal(d.threshold, null);
  assert.match(d.reason, /No calibrated threshold/);
});

test('shipped calibration: off-résumé profiles abstain, on-résumé pass', () => {
  const cal = loadOODCalibration();
  assert.equal(cal.schemaVersion, 1);
  // Face validity against the SHIPPED conformal threshold.
  assert.equal(decideOOD(POKEMON).abstain, true);
  assert.equal(decideOOD(LEXAPRO).abstain, true);
  assert.equal(decideOOD(LIBRARY_REF).abstain, false);
  assert.equal(decideOOD(MLIS).abstain, false);
});

test('shipped calibration is internally consistent', () => {
  const cal = loadOODCalibration();
  assert.deepEqual(cal.scoreWeights, OOD_SCORE_WEIGHTS);
  assert.equal(cal.targetAbstainRate, 0.15);
  if (cal.threshold !== null) {
    assert.ok(cal.threshold > 0 && cal.threshold < 1);
  }
});

test('OOD_ABSTAIN_MESSAGE is honest and never fabricates', () => {
  assert.match(OOD_ABSTAIN_MESSAGE, /won't invent|won’t invent/i);
  assert.ok(OOD_ABSTAIN_MESSAGE.length > 40);
});
