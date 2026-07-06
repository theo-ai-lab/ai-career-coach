/**
 * Anti-drift tests for the committed demo-mode artifacts (SYNTHETIC demo
 * embedding space — see embeddings.ts for what that means and does not mean).
 *
 * Independently RE-DERIVES the demo corpus vectors and the demo τ from the
 * committed sources (the fictional persona + the red-team prompt set) using
 * the shared conformal primitives, and asserts they equal demo-corpus.json /
 * demo-calibration.json. This is NOT a re-run of
 * scripts/build-demo-artifacts.ts — the derivation is reproduced here so the
 * test fails if EITHER the artifact OR the script drifts from the documented
 * procedure. Same pattern as lib/quality-gates/ood-gate.calibration.test.ts
 * for the production artifact.
 *
 * Zero model spend, fully deterministic. No DB, no key, no LLM.
 * Run: npx tsx --test lib/demo/demo-artifacts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import {
  buildIdfTable,
  embedDemoText,
  tokenize,
  DEMO_EMBEDDING_SPACE,
  type DemoIdfTable,
} from './embeddings';
import { similaritiesTo } from '@/lib/quality-gates/vector-math';
import {
  scoreOOD,
  conformalQuantileRank,
  splitConformalThreshold,
  wilsonInterval,
  seededShuffle,
  OOD_SCORE_WEIGHTS,
} from '@/lib/quality-gates/ood-score';
import demoCorpus from './demo-corpus.json';
import demoCalibration from './demo-calibration.json';

// ---- Fixed demo-space choices, mirrored from scripts/build-demo-artifacts.ts
const DEMO_TARGET_ABSTAIN_RATE = 0.45; // demo-specific budget — NOT production α
const SPLIT_SEED = 42;
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;
const MATCH_COUNT = 6;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

function round(x: number, dp = 6): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

// Re-derive the corpus exactly as the build script documents: chunk the
// committed fictional persona (frontmatter stripped), build the idf
// vocabulary, embed each chunk, round to 6dp.
async function deriveCorpus() {
  const personaRaw = readFileSync(
    join(repoRoot, 'data/eval-benchmark/personas/synthetic-redteam-resume.md'),
    'utf8',
  );
  const personaBody = personaRaw.replace(/^---\n[\s\S]*?\n---\n/, '');
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const chunkTexts = await splitter.splitText(personaBody);
  const idfTable = buildIdfTable(chunkTexts.map((c) => tokenize(c)));
  const vectors = chunkTexts.map((c) =>
    embedDemoText(c, idfTable).map((x) => round(x)),
  );
  return { chunkTexts, idfTable, vectors };
}

test('committed demo corpus matches a re-derivation from the committed persona', async () => {
  const { chunkTexts, idfTable, vectors } = await deriveCorpus();

  assert.equal(demoCorpus.embeddingSpace, DEMO_EMBEDDING_SPACE);
  assert.match(demoCorpus._label, /SYNTHETIC DEMO ARTIFACT/);
  assert.match(demoCorpus._label, /fictional/i);
  assert.match(demoCorpus._label, /NOT model embeddings/);

  assert.deepEqual(
    demoCorpus.chunks.map((c) => c.content),
    chunkTexts,
    'chunk texts drifted between artifact and persona-file re-derivation',
  );
  assert.equal(demoCorpus.idf.nDocs, idfTable.nDocs);
  assert.deepEqual(
    demoCorpus.idf.idf,
    Object.fromEntries(
      Object.entries(idfTable.idf).map(([t, v]) => [t, round(v)]),
    ),
    'idf vocabulary drifted',
  );
  assert.deepEqual(
    demoCorpus.chunks.map((c) => c.embedding),
    vectors,
    'committed chunk vectors drifted from a re-embedding',
  );
});

test('committed demo τ matches the split-conformal re-derivation over the demo space', () => {
  // Score every non-empty red-team prompt exactly the way the demo runtime
  // does: embed with the COMMITTED idf table, top-k cosine against the
  // COMMITTED (rounded) chunk vectors, scoreOOD.
  const promptsDoc = JSON.parse(
    readFileSync(
      join(repoRoot, 'data/eval-benchmark/red-team-prompts.json'),
      'utf8',
    ),
  ) as { prompts: Array<{ id: string; category: string; text: string }> };

  const idfTable: DemoIdfTable = demoCorpus.idf;
  const chunkVectors = demoCorpus.chunks.map((c) => c.embedding);
  const profiles = promptsDoc.prompts
    .filter((p) => p.text && p.text.trim().length > 0) // ec-01 excluded, as in prod
    .map((p) => {
      const sims = similaritiesTo(
        embedDemoText(p.text, idfTable),
        chunkVectors,
      ).slice(0, MATCH_COUNT);
      return { id: p.id, oodScore: scoreOOD(sims).score };
    });

  const n = profiles.length;
  const scores = profiles.map((p) => p.oodScore);
  const rank = conformalQuantileRank(n, DEMO_TARGET_ABSTAIN_RATE);
  const tau = splitConformalThreshold(scores, DEMO_TARGET_ABSTAIN_RATE);
  assert.ok(Number.isFinite(tau), 'demo τ must be certifiable at the demo α');
  const abstained = profiles.filter((p) => p.oodScore > tau);

  assert.match(demoCalibration._label, /SYNTHETIC DEMO ARTIFACT/);
  assert.match(demoCalibration._label, /DEMO-SPECIFIC/);
  assert.deepEqual(demoCalibration.scoreWeights, OOD_SCORE_WEIGHTS);
  assert.equal(demoCalibration.targetAbstainRate, DEMO_TARGET_ABSTAIN_RATE);
  assert.equal(demoCalibration.n, n);
  assert.equal(demoCalibration.conformalRank, rank);
  assert.equal(demoCalibration.threshold, round(tau));
  assert.equal(demoCalibration.realizedAbstainRate, round(abstained.length / n));
  assert.equal(demoCalibration.matchCount, MATCH_COUNT);
  assert.deepEqual(
    [...demoCalibration.abstained.map((a) => a.id)].sort(),
    abstained.map((a) => a.id).sort(),
    'the set of abstained calibration prompts drifted',
  );

  // Held-out honesty check: one fixed-seed 50/50 split, scored once.
  const shuffled = seededShuffle(profiles, SPLIT_SEED);
  const half = Math.floor(n / 2);
  const calHalf = shuffled.slice(0, half);
  const valHalf = shuffled.slice(half);
  const calTau = splitConformalThreshold(
    calHalf.map((p) => p.oodScore),
    DEMO_TARGET_ABSTAIN_RATE,
  );
  const valAbstained = valHalf.filter((p) => p.oodScore > calTau);
  const valWilson = wilsonInterval(valAbstained.length, valHalf.length);

  assert.equal(demoCalibration.validation.seed, SPLIT_SEED);
  assert.equal(demoCalibration.validation.calSize, calHalf.length);
  assert.equal(demoCalibration.validation.valSize, valHalf.length);
  assert.equal(demoCalibration.validation.calThreshold, round(calTau));
  assert.equal(demoCalibration.validation.valAbstainCount, valAbstained.length);
  assert.equal(
    demoCalibration.validation.valAbstainRate,
    round(valAbstained.length / valHalf.length),
  );
  assert.deepEqual(demoCalibration.validation.valWilson95, {
    low: round(valWilson.low),
    high: round(valWilson.high),
  });
});

test('demo τ sits below the closed-vocabulary ceiling, so fully-off-corpus queries abstain', () => {
  // In this space a query sharing no vocabulary with the corpus scores exactly
  // 1.0. The demo α was chosen so τ is the largest calibration score BELOW
  // that ceiling (see scripts/build-demo-artifacts.ts) — assert both halves.
  assert.ok(demoCalibration.threshold !== null);
  assert.ok(demoCalibration.threshold < 1);
  assert.ok(1 > demoCalibration.threshold); // score 1 ⇒ strict > τ ⇒ abstains
  for (const a of demoCalibration.abstained) {
    assert.ok(a.oodScore > demoCalibration.threshold);
  }
});
