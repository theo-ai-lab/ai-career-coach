/**
 * Anti-drift calibration test.
 *
 * Independently RE-DERIVES the conformal threshold τ and the cascade-telemetry
 * slice from the committed red-team run (data/eval-benchmark/red-team-raw-results.json)
 * using only the shared primitives in ood-score.ts, and asserts they equal the
 * committed artifacts (ood-calibration.json, cascade-replay.json). This is NOT a
 * re-run of scripts/calibrate-ood-gate.ts — the extraction + quality-bar logic is
 * reproduced here so the test fails if EITHER the artifact OR the script drifts
 * from the documented procedure in docs/OOD_GATE_CALIBRATION.md.
 *
 * Zero model spend: a deterministic replay over already-recorded similarities +
 * judge scores. No DB, no key, no LLM.
 *
 * Run: npx tsx --test lib/quality-gates/ood-gate.calibration.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  scoreOOD,
  conformalQuantileRank,
  splitConformalThreshold,
  seededShuffle,
} from './ood-score';

// ---- Fixed-a-priori choices, mirrored from the calibration script ----------
const TARGET_ABSTAIN_RATE = 0.15;
const SPLIT_SEED = 42;
const QUALITY_BAR = { overallMin: 80, groundingMin: 4, honestyMin: 4 };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(repoRoot, rel), 'utf8')) as T;
}

function round(x: number, dp = 6): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

interface Attempt {
  prompt_id: string;
  category: string;
  prompt_text: string;
  scores?: { overall?: number; grounding?: number; honesty?: number } | null;
  raw_body?: { sources?: Array<{ similarity?: unknown }> } | null;
}
interface Profile {
  id: string;
  sims: number[];
  oodScore: number;
  overall: number | null;
  grounding: number | null;
  honesty: number | null;
}

function loadProfiles(): Profile[] {
  const raw = readJson<{ attempts: Attempt[] }>(
    'data/eval-benchmark/red-team-raw-results.json',
  );
  const out: Profile[] = [];
  for (const a of raw.attempts) {
    if (!a.prompt_text || a.prompt_text.trim().length === 0) continue;
    const sims = (a.raw_body?.sources ?? [])
      .map((s) => s.similarity)
      .filter((v): v is number => typeof v === 'number');
    if (sims.length === 0) continue;
    out.push({
      id: a.prompt_id,
      sims,
      oodScore: scoreOOD(sims).score,
      overall: a.scores?.overall ?? null,
      grounding: a.scores?.grounding ?? null,
      honesty: a.scores?.honesty ?? null,
    });
  }
  return out;
}

function clearedQualityBar(p: Profile): boolean {
  return (
    p.overall !== null &&
    p.grounding !== null &&
    p.honesty !== null &&
    p.overall >= QUALITY_BAR.overallMin &&
    p.grounding >= QUALITY_BAR.groundingMin &&
    p.honesty >= QUALITY_BAR.honestyMin
  );
}

interface OODCalArtifact {
  schemaVersion: number;
  targetAbstainRate: number;
  n: number;
  conformalRank: number | null;
  threshold: number | null;
  realizedAbstainRate: number;
  scoreWeights: { coverage: number; centroidProximity: number };
}
interface CascadeArtifact {
  boundary: string;
  n: number;
  threshold: number | null;
  alpha: number;
  expensiveShare: number;
  disagreementRate: number;
  losslessViolations: number;
  validation: {
    seed: number;
    calSize: number;
    valSize: number;
    calThreshold: number | null;
    valAbstainCount: number;
    valAbstainRate: number;
  };
}

test('committed ood-calibration.json matches an independent re-derivation', () => {
  const cal = readJson<OODCalArtifact>('lib/quality-gates/ood-calibration.json');
  const profiles = loadProfiles();
  const n = profiles.length;
  const scores = profiles.map((p) => p.oodScore);

  // n must match (drift here = the red-team source changed under the artifact).
  assert.equal(n, cal.n, `profile count ${n} != committed n ${cal.n}`);

  const rank = conformalQuantileRank(n, TARGET_ABSTAIN_RATE);
  assert.equal(rank, cal.conformalRank);

  const tau = splitConformalThreshold(scores, TARGET_ABSTAIN_RATE);
  const derivedThreshold = Number.isFinite(tau) ? round(tau) : null;
  assert.equal(derivedThreshold, cal.threshold, 'derived τ != committed threshold');

  const abstained = profiles.filter(
    (p) => cal.threshold !== null && p.oodScore > cal.threshold,
  );
  assert.equal(round(abstained.length / n, 6), cal.realizedAbstainRate);

  assert.equal(cal.targetAbstainRate, TARGET_ABSTAIN_RATE);
});

test('committed cascade-replay.json matches an independent re-derivation', () => {
  const slice = readJson<CascadeArtifact>('lib/quality-gates/cascade-replay.json');
  const profiles = loadProfiles();
  const n = profiles.length;

  assert.equal(slice.n, n);
  assert.equal(slice.boundary, 'ood-gate->llm-generation');

  // Cheap tier resolves everything strictly above τ, with NO LLM call.
  const resolved = profiles.filter(
    (p) => slice.threshold !== null && p.oodScore > slice.threshold,
  );
  const lossless = resolved.filter(clearedQualityBar);

  assert.equal(round(resolved.length / n, 6), slice.alpha);
  assert.equal(round((n - resolved.length) / n, 6), slice.expensiveShare);
  assert.equal(slice.losslessViolations, lossless.length);
  assert.equal(
    slice.disagreementRate,
    resolved.length === 0 ? 0 : round(lossless.length / resolved.length, 6),
  );

  // alpha + expensiveShare partition the corpus.
  assert.ok(Math.abs(slice.alpha + slice.expensiveShare - 1) < 1e-6);
});

test('held-out validation split (fixed seed, scored once) matches the artifact', () => {
  const slice = readJson<CascadeArtifact>('lib/quality-gates/cascade-replay.json');
  const profiles = loadProfiles();
  const shuffled = seededShuffle(profiles, SPLIT_SEED);
  const half = Math.floor(profiles.length / 2);
  const calHalf = shuffled.slice(0, half);
  const valHalf = shuffled.slice(half);

  const calTau = splitConformalThreshold(
    calHalf.map((p) => p.oodScore),
    TARGET_ABSTAIN_RATE,
  );
  const valAbstained = valHalf.filter((p) => p.oodScore > calTau);

  assert.equal(slice.validation.seed, SPLIT_SEED);
  assert.equal(slice.validation.calSize, calHalf.length);
  assert.equal(slice.validation.valSize, valHalf.length);
  assert.equal(
    slice.validation.calThreshold,
    Number.isFinite(calTau) ? round(calTau) : null,
  );
  assert.equal(slice.validation.valAbstainCount, valAbstained.length);
  assert.equal(
    slice.validation.valAbstainRate,
    round(valAbstained.length / valHalf.length, 6),
  );
});
