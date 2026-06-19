/**
 * quality-gates/ood-score.ts
 *
 * Pure, artifact-free primitives for the OOD gate: the retrieval-surprise SCORE
 * and the split-conformal calibration math. This module has NO dependency on the
 * committed calibration artifact, so it can be shared by BOTH the runtime gate
 * (ood-gate.ts, which adds the artifact + the abstain decision) AND the offline
 * calibration script (scripts/calibrate-ood-gate.ts, which GENERATES the
 * artifact) — without a bootstrap cycle.
 *
 * Everything here is deterministic and unit-testable with plain `number[]`
 * similarity profiles. No DB, no key, no LLM, no `server-only`.
 *
 * See ood-gate.ts for the full rationale of the score's functional form and the
 * conformal-abstention threshold (Conformal Abstention, arXiv:2405.01563).
 */

import { mean, clamp } from './vector-math';

/** Fixed-a-priori weights of the support score. NOT fit to the data. */
export const OOD_SCORE_WEIGHTS = {
  coverage: 0.6,
  centroidProximity: 0.4,
} as const;

export interface OODScore {
  /** Best single retrieved cosine similarity, clamped to [0,1]. */
  coverage: number;
  /** Mean retrieved cosine similarity (centroid-proximity surrogate), [0,1]. */
  centroidProximity: number;
  /** s₁ − mean(s₂…s_k), clamped to [0,1]. Diagnostic only (see ood-gate docs). */
  margin: number;
  /** 0.6·coverage + 0.4·centroidProximity, in [0,1]. */
  support: number;
  /** OOD nonconformity score = 1 − support, in [0,1]. Higher ⇒ more surprising. */
  score: number;
}

/**
 * Compute the OOD score from a query's retrieved top-k cosine similarities.
 * Order-independent (sorted internally). An empty profile is maximally
 * surprising (score 1): there is no retrieved evidence at all.
 */
export function scoreOOD(similarities: readonly number[]): OODScore {
  if (similarities.length === 0) {
    return { coverage: 0, centroidProximity: 0, margin: 0, support: 0, score: 1 };
  }
  const sorted = [...similarities].sort((a, b) => b - a);
  const coverage = clamp(sorted[0], 0, 1);
  const centroidProximity = clamp(mean(sorted), 0, 1);
  const rest = sorted.slice(1);
  const margin =
    rest.length === 0 ? coverage : clamp(coverage - mean(rest), 0, 1);
  const support =
    OOD_SCORE_WEIGHTS.coverage * coverage +
    OOD_SCORE_WEIGHTS.centroidProximity * centroidProximity;
  return {
    coverage,
    centroidProximity,
    margin,
    support,
    score: clamp(1 - support, 0, 1),
  };
}

/**
 * Split-conformal order-statistic rank (1-based) for a target abstain budget α
 * over n calibration points: ⌈(n+1)(1−α)⌉. Returns `null` when the rank exceeds
 * n — i.e. n is too small to certify this α, in which case the caller must treat
 * the threshold as +∞ (never abstain) rather than guess one.
 */
export function conformalQuantileRank(n: number, alpha: number): number | null {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`conformalQuantileRank: n must be a positive integer, got ${n}`);
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error(`conformalQuantileRank: alpha must be in (0,1), got ${alpha}`);
  }
  const rank = Math.ceil((n + 1) * (1 - alpha));
  return rank > n ? null : rank;
}

/**
 * The split-conformal abstention threshold τ for the given calibration scores
 * and target abstain budget α. Returns `Infinity` when n cannot certify α (so
 * the gate never abstains rather than abstaining on a fabricated threshold).
 */
export function splitConformalThreshold(
  calibrationScores: readonly number[],
  alpha: number,
): number {
  const rank = conformalQuantileRank(calibrationScores.length, alpha);
  if (rank === null) return Infinity;
  const ascending = [...calibrationScores].sort((a, b) => a - b);
  return ascending[rank - 1];
}

/**
 * Wilson score interval for a binomial proportion — the honest CI to report on
 * a realized abstain/violation rate at small n (the Normal approximation is
 * wrong near 0/1 and at n in the tens). z defaults to 1.96 (≈95%).
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return {
    low: clamp((center - margin) / denom, 0, 1),
    high: clamp((center + margin) / denom, 0, 1),
  };
}

/**
 * Deterministic mulberry32 PRNG — used ONLY by the calibration script's
 * fixed-seed train/validation split so the held-out honesty check is exactly
 * reproducible. Kept here (not in the script) so it is unit-tested.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle of indices [0..n) driven by a seeded PRNG. Pure-ish: returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
