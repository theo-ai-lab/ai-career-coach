/**
 * scripts/ci/check-calibration-docs.ts
 *
 * Claims-drift gate for the DOCUMENTED calibration numbers. The repo's pitch is
 * that every headline number is regenerated from committed data — so CI must be
 * able to catch a doc that silently stops matching the data.
 *
 * This script re-derives the conformal threshold τ (and the cascade slice)
 * from the committed red-team run using the shared primitives in
 * lib/quality-gates/ood-score.ts, then PARSES the numbers actually written in:
 *
 *   - docs/OOD_GATE_CALIBRATION.md  §2 "Shipped values" table (α, n, rank, τ,
 *     realized abstain rate) and §4 cascade-slice table (alpha, expensiveShare,
 *     disagreementRate, losslessViolations, n)
 *   - README.md                      the stated abstain budget (α = …)
 *
 * and fails (exit 1) if any documented value differs from the re-derived one or
 * from the committed artifacts (ood-calibration.json / cascade-replay.json).
 * Parsing is fail-closed: if an expected table row can no longer be located,
 * that is an error too — a check that silently matches nothing is not a gate.
 *
 * Zero model spend: pure replay over already-recorded similarities + judge
 * scores. Run: npx tsx scripts/ci/check-calibration-docs.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  scoreOOD,
  conformalQuantileRank,
  splitConformalThreshold,
} from '../../lib/quality-gates/ood-score';

// ---- Fixed-a-priori choices, mirrored from scripts/calibrate-ood-gate.ts ---
const TARGET_ABSTAIN_RATE = 0.15;
const QUALITY_BAR = { overallMin: 80, groundingMin: 4, honestyMin: 4 };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const TAG = '[check-calibration-docs]';

interface Attempt {
  prompt_id: string;
  prompt_text: string;
  scores?: { overall?: number; grounding?: number; honesty?: number } | null;
  raw_body?: { sources?: Array<{ similarity?: unknown }> } | null;
}

interface Profile {
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
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'data/eval-benchmark/red-team-raw-results.json'), 'utf8'),
  ) as { attempts: Attempt[] };
  const profiles: Profile[] = [];
  for (const a of raw.attempts) {
    // Empty-query case is excluded — input-validation rejects it pre-gate.
    if (!a.prompt_text || a.prompt_text.trim().length === 0) continue;
    const sims = (a.raw_body?.sources ?? [])
      .map((s) => s.similarity)
      .filter((v): v is number => typeof v === 'number');
    if (sims.length === 0) continue;
    profiles.push({
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

// ---- Fail-closed doc parsing ------------------------------------------------

const failures: string[] = [];

function parseNumber(source: string, label: string, pattern: RegExp): number | null {
  const m = source.match(pattern);
  if (!m) {
    failures.push(`could not locate "${label}" (pattern ${pattern}) — doc structure changed?`);
    return null;
  }
  return Number(m[1]);
}

function expectEqual(label: string, documented: number | null, derived: number): void {
  if (documented === null) return; // parse failure already recorded
  if (documented !== derived) {
    failures.push(`${label}: documented ${documented} != derived ${derived}`);
  } else {
    console.log(`${TAG} OK: ${label} = ${derived}`);
  }
}

function main() {
  // --- Re-derive from the committed red-team data. ---
  const profiles = loadProfiles();
  const n = profiles.length;
  const scores = profiles.map((p) => p.oodScore);
  const rank = conformalQuantileRank(n, TARGET_ABSTAIN_RATE);
  const tau = splitConformalThreshold(scores, TARGET_ABSTAIN_RATE);
  const threshold = Number.isFinite(tau) ? round(tau) : null;
  if (threshold === null || rank === null) {
    console.error(`${TAG} FAIL: derivation produced no certifiable threshold (n=${n}).`);
    process.exit(1);
  }
  const resolved = profiles.filter((p) => p.oodScore > threshold);
  const lossless = resolved.filter(clearedQualityBar);
  const derived = {
    alpha: TARGET_ABSTAIN_RATE,
    n,
    rank,
    tau: threshold,
    realizedAbstainRate: round(resolved.length / n, 6),
    cascade: {
      alpha: round(resolved.length / n, 6),
      expensiveShare: round((n - resolved.length) / n, 6),
      disagreementRate:
        resolved.length === 0 ? 0 : round(lossless.length / resolved.length, 6),
      losslessViolations: lossless.length,
      n,
    },
  };

  // --- Committed artifacts must equal the derivation. ---
  const cal = JSON.parse(
    readFileSync(join(repoRoot, 'lib/quality-gates/ood-calibration.json'), 'utf8'),
  ) as { targetAbstainRate: number; n: number; conformalRank: number; threshold: number };
  const replay = JSON.parse(
    readFileSync(join(repoRoot, 'lib/quality-gates/cascade-replay.json'), 'utf8'),
  ) as { alpha: number; expensiveShare: number; disagreementRate: number; losslessViolations: number; n: number };

  expectEqual('ood-calibration.json threshold (τ)', cal.threshold, derived.tau);
  expectEqual('ood-calibration.json n', cal.n, derived.n);
  expectEqual('ood-calibration.json conformalRank', cal.conformalRank, derived.rank);
  expectEqual('cascade-replay.json alpha', replay.alpha, derived.cascade.alpha);
  expectEqual('cascade-replay.json losslessViolations', replay.losslessViolations, derived.cascade.losslessViolations);

  // --- docs/OOD_GATE_CALIBRATION.md §2 "Shipped values" table. ---
  const doc = readFileSync(join(repoRoot, 'docs/OOD_GATE_CALIBRATION.md'), 'utf8');
  expectEqual(
    'doc §2 α (target abstain budget)',
    parseNumber(doc, 'doc §2 α row', /^\| α \(target abstain budget\) \| ([0-9.]+) \|/m),
    derived.alpha,
  );
  expectEqual(
    'doc §2 n',
    parseNumber(doc, 'doc §2 n row', /^\| n \(queries with retrieved similarities\) \| (\d+) \|/m),
    derived.n,
  );
  expectEqual(
    'doc §2 conformal rank',
    parseNumber(doc, 'doc §2 rank row', /^\| conformal rank[^|]*\| (\d+) \|/m),
    derived.rank,
  );
  expectEqual(
    'doc §2 τ',
    parseNumber(doc, 'doc §2 τ row', /^\| \*\*τ\*\*[^|]*\| \*\*([0-9.]+)\*\* \|/m),
    derived.tau,
  );
  expectEqual(
    'doc §2 realized in-sample abstain rate',
    parseNumber(doc, 'doc §2 realized-rate row', /^\| realized in-sample abstain rate[^|]*\| ([0-9.]+)/m),
    derived.realizedAbstainRate,
  );

  // --- docs/OOD_GATE_CALIBRATION.md §4 cascade-slice table. ---
  for (const [field, value] of Object.entries(derived.cascade)) {
    expectEqual(
      `doc §4 \`${field}\``,
      parseNumber(doc, `doc §4 ${field} row`, new RegExp(`^\\| \`${field}\`` + ' \\| ([0-9.]+) \\|', 'm')),
      value,
    );
  }

  // --- README.md states the abstain budget in the OOD-gate bullet. ---
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  expectEqual(
    'README abstain budget (α = …)',
    parseNumber(readme, 'README α mention', /target abstain budget \(α = ([0-9.]+)\)/),
    derived.alpha,
  );

  if (failures.length > 0) {
    for (const f of failures) console.error(`${TAG} DRIFT: ${f}`);
    console.error(
      `${TAG} FAIL: documented calibration numbers no longer match the committed data.\n` +
        `${TAG} If the data legitimately changed: re-run \`npx tsx scripts/calibrate-ood-gate.ts\` ` +
        `and update docs/OOD_GATE_CALIBRATION.md + README.md to the regenerated values.`,
    );
    process.exit(1);
  }
  console.log(`${TAG} all documented calibration numbers match the re-derived values.`);
}

main();
