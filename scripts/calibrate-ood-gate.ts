/**
 * scripts/calibrate-ood-gate.ts
 *
 * Regenerates the OOD gate's committed calibration artifacts from the committed
 * red-team run — ZERO model spend (pure replay of already-recorded similarities
 * + judge scores). Run:
 *
 *   npx tsx scripts/calibrate-ood-gate.ts          # write the artifacts
 *   npx tsx scripts/calibrate-ood-gate.ts --check  # verify on-disk == derived
 *
 * WHAT IT DERIVES (all from data/eval-benchmark/red-team-raw-results.json):
 *   1. lib/quality-gates/ood-calibration.json — the split-conformal abstention
 *      threshold τ for the target abstain budget α (fixed a priori below), plus
 *      provenance. ood-gate.ts imports this.
 *   2. lib/quality-gates/cascade-replay.json — the cascade-telemetry slice for
 *      the OOD-gate → LLM-generation boundary: how much the deterministic cheap
 *      tier resolves, and (against the committed judge scores) how often that
 *      cheap resolution would have denied an answer the expensive tier scored as
 *      clearing the quality bar (lossless violations). cascade-telemetry.ts
 *      imports this.
 *
 * HONESTY: α and the score's functional form are FIXED before looking at any
 * detection outcome (see docs/OOD_GATE_CALIBRATION.md). The threshold is the
 * only value fit to data; it is fit by the standard split-conformal quantile.
 * The held-out 50/50 split (fixed seed) is scored ONCE to show the abstain
 * budget holds out-of-sample; the shipped τ is then refit on all n (standard).
 *
 * The empty-query red-team case (ec-01) is excluded: production input-validation
 * rejects empty queries before this gate, so it can never reach the gate.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  scoreOOD,
  conformalQuantileRank,
  splitConformalThreshold,
  wilsonInterval,
  seededShuffle,
} from '../lib/quality-gates/ood-score';

// ---- Fixed-a-priori choices (NOT tuned to detection outcomes) -------------
const TARGET_ABSTAIN_RATE = 0.15; // conservative abstain budget α
const SPLIT_SEED = 42; // matches the eval benchmark's documented seed convention
// "Cleared the quality bar" mirrors the EXISTING satisficing criteria
// (DEFAULT_SATISFICING_CRITERIA: overall≥80, honesty≥4, grounding≥4). A query
// the gate abstains on is a LOSSLESS VIOLATION only if the expensive tier's
// committed answer cleared this same bar (we denied a genuinely good answer).
const QUALITY_BAR = { overallMin: 80, groundingMin: 4, honestyMin: 4 };

const SCHEMA_VERSION = 1;
const SOURCE_REL = 'data/eval-benchmark/red-team-raw-results.json';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

interface Attempt {
  prompt_id: string;
  category: string;
  prompt_text: string;
  scores?: { overall?: number; grounding?: number; honesty?: number } | null;
  raw_body?: { sources?: Array<{ similarity?: unknown }> } | null;
}

interface Profile {
  id: string;
  category: string;
  sims: number[];
  oodScore: number;
  overall: number | null;
  grounding: number | null;
  honesty: number | null;
}

function round(x: number, dp = 6): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function loadProfiles(): Profile[] {
  const raw = JSON.parse(readFileSync(join(repoRoot, SOURCE_REL), 'utf8')) as {
    attempts: Attempt[];
  };
  const profiles: Profile[] = [];
  for (const a of raw.attempts) {
    // Exclude the empty-query case — input-validation rejects it pre-gate.
    if (!a.prompt_text || a.prompt_text.trim().length === 0) continue;
    const sims = (a.raw_body?.sources ?? [])
      .map((s) => s.similarity)
      .filter((v): v is number => typeof v === 'number');
    if (sims.length === 0) continue;
    profiles.push({
      id: a.prompt_id,
      category: a.category,
      sims,
      oodScore: scoreOOD(sims).score,
      overall: a.scores?.overall ?? null,
      grounding: a.scores?.grounding ?? null,
      honesty: a.scores?.honesty ?? null,
    });
  }
  return profiles;
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

function buildArtifacts() {
  const profiles = loadProfiles();
  const n = profiles.length;
  const scores = profiles.map((p) => p.oodScore);

  // --- Shipped threshold: split-conformal quantile on the FULL sample. ---
  const rank = conformalQuantileRank(n, TARGET_ABSTAIN_RATE);
  const tau = splitConformalThreshold(scores, TARGET_ABSTAIN_RATE);
  const threshold = Number.isFinite(tau) ? round(tau) : null;
  const abstained = profiles.filter((p) => threshold !== null && p.oodScore > threshold);
  const realizedAbstainRate = round(abstained.length / n, 6);

  const oodCalibration = {
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: SOURCE_REL,
    scoreWeights: { coverage: 0.6, centroidProximity: 0.4 },
    targetAbstainRate: TARGET_ABSTAIN_RATE,
    n,
    conformalRank: rank,
    threshold,
    realizedAbstainRate,
  };

  // --- Held-out honesty check: one fixed-seed 50/50 split, scored ONCE. ---
  const shuffled = seededShuffle(profiles, SPLIT_SEED);
  const half = Math.floor(n / 2);
  const calHalf = shuffled.slice(0, half);
  const valHalf = shuffled.slice(half);
  const calTau = splitConformalThreshold(
    calHalf.map((p) => p.oodScore),
    TARGET_ABSTAIN_RATE,
  );
  const valAbstained = valHalf.filter((p) => p.oodScore > calTau);
  const valRate = valAbstained.length / valHalf.length;
  const valWilson = wilsonInterval(valAbstained.length, valHalf.length);

  // --- Cascade replay: OOD-gate (cheap, deterministic) → LLM (expensive). ---
  const resolved = abstained; // cheap tier resolves these without an LLM call
  const losslessViolations = resolved.filter(clearedQualityBar);
  const disagreementRate =
    resolved.length === 0 ? 0 : round(losslessViolations.length / resolved.length, 6);

  const cascadeReplay = {
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: SOURCE_REL,
    boundary: 'ood-gate->llm-generation',
    cheapTier: 'deterministic OOD screen (keyless, over pgvector similarities)',
    expensiveTier: 'LLM generation + LLM-as-judge',
    qualityBar: QUALITY_BAR,
    n,
    threshold,
    targetAbstainRate: TARGET_ABSTAIN_RATE,
    // Cascade contract triple.
    alpha: round(resolved.length / n, 6), // fraction the cheap tier resolved w/o escalating
    expensiveShare: round((n - resolved.length) / n, 6), // fraction escalated to expensive tier
    disagreementRate, // of resolved, fraction the expensive tier would have answered above the bar
    losslessViolations: losslessViolations.length, // cheap resolutions the expensive tier would NOT have made
    resolvedCount: resolved.length,
    resolved: resolved
      .map((p) => ({
        id: p.id,
        category: p.category,
        oodScore: round(p.oodScore),
        overall: p.overall,
        grounding: p.grounding,
        honesty: p.honesty,
        clearedQualityBar: clearedQualityBar(p),
      }))
      .sort((a, b) => b.oodScore - a.oodScore),
    validation: {
      seed: SPLIT_SEED,
      calSize: calHalf.length,
      valSize: valHalf.length,
      calThreshold: Number.isFinite(calTau) ? round(calTau) : null,
      valAbstainCount: valAbstained.length,
      valAbstainRate: round(valRate, 6),
      valWilson95: { low: round(valWilson.low), high: round(valWilson.high) },
    },
  };

  return { oodCalibration, cascadeReplay, profiles };
}

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const { oodCalibration, cascadeReplay } = buildArtifacts();

  const targets: Array<{ rel: string; data: unknown }> = [
    { rel: 'lib/quality-gates/ood-calibration.json', data: oodCalibration },
    { rel: 'lib/quality-gates/cascade-replay.json', data: cascadeReplay },
  ];

  let drift = false;
  for (const { rel, data } of targets) {
    const path = join(repoRoot, rel);
    const next = stableStringify(data);
    if (check) {
      let current = '';
      try {
        current = readFileSync(path, 'utf8');
      } catch {
        current = '';
      }
      if (current !== next) {
        drift = true;
        console.error(`[calibrate-ood-gate] DRIFT: ${rel} is out of date.`);
      } else {
        console.log(`[calibrate-ood-gate] OK: ${rel} matches derived value.`);
      }
    } else {
      writeFileSync(path, next);
      console.log(`[calibrate-ood-gate] wrote ${rel}`);
    }
  }

  console.log(
    `\nα=${oodCalibration.targetAbstainRate}  n=${oodCalibration.n}  rank=${oodCalibration.conformalRank}  τ=${oodCalibration.threshold}  realized abstain=${oodCalibration.realizedAbstainRate}`,
  );
  console.log(
    `cascade: alpha=${cascadeReplay.alpha}  expensiveShare=${cascadeReplay.expensiveShare}  disagreement=${cascadeReplay.disagreementRate}  losslessViolations=${cascadeReplay.losslessViolations}`,
  );

  if (check && drift) process.exit(1);
}

main();
