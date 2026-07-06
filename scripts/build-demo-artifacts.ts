/**
 * scripts/build-demo-artifacts.ts
 *
 * Regenerates the committed DEMO-MODE artifacts — ZERO model spend, ZERO keys
 * (everything is derived deterministically from committed files). Run:
 *
 *   npx tsx scripts/build-demo-artifacts.ts          # write the artifacts
 *   npx tsx scripts/build-demo-artifacts.ts --check  # verify on-disk == derived
 *
 * WHAT IT DERIVES
 *   1. lib/demo/demo-corpus.json — the demo resume corpus: the committed
 *      FICTIONAL persona (data/eval-benchmark/personas/synthetic-redteam-resume.md,
 *      "Avery Patel") chunked with the same splitter family the live upload
 *      path uses (RecursiveCharacterTextSplitter), plus each chunk's vector in
 *      the deterministic demo embedding space (lib/demo/embeddings.ts) and the
 *      space's idf vocabulary table.
 *   2. lib/demo/demo-calibration.json — the demo OOD abstention threshold τ,
 *      re-derived over the demo space with the SAME split-conformal procedure
 *      as production (lib/quality-gates/ood-score.ts: conformalQuantileRank /
 *      splitConformalThreshold, plus the same fixed-seed held-out honesty
 *      check), using the committed red-team prompt set as the calibration
 *      sample.
 *
 * HONESTY / LABELING
 * ------------------
 * The demo embedding space is SYNTHETIC (hashed tf-idf over a closed corpus
 * vocabulary — see lib/demo/embeddings.ts). Only the embedding space is
 * synthetic: the conformal calibration MECHANISM executes for real over it.
 * Its numbers (τ, realized abstain rate) describe the demo space only and say
 * nothing about the production calibration (α = 0.15 over model embeddings,
 * lib/quality-gates/ood-calibration.json).
 *
 * THE DEMO ABSTAIN BUDGET (α = 0.45) IS DEMO-SPECIFIC, NOT THE PRODUCTION α.
 * In the closed-vocabulary demo space, a query sharing no vocabulary with the
 * demo resume has cosine 0 to every chunk — OOD score exactly 1.0, the space's
 * ceiling. 10 of the 24 red-team calibration prompts sit at that ceiling, so
 * budgets below ~0.44 put τ at 1.0 and the strict `score > τ` rule could never
 * abstain. α = 0.45 (rank 14 of 24) is the budget that certifies abstention on
 * exactly the fully-off-corpus tail; the resulting τ is the largest calibration
 * score BELOW the ceiling. That composition-driven choice is a property of the
 * synthetic space and the adversarial calibration set — documented here and in
 * the artifact itself so it cannot be mistaken for the production budget.
 *
 * The empty-query prompt (ec-01) is excluded, mirroring production: input
 * validation rejects empty queries before any gate runs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import {
  scoreOOD,
  conformalQuantileRank,
  splitConformalThreshold,
  wilsonInterval,
  seededShuffle,
} from '../lib/quality-gates/ood-score';
import { similaritiesTo } from '../lib/quality-gates/vector-math';
import {
  buildIdfTable,
  embedDemoText,
  tokenize,
  DEMO_EMBEDDING_DIM,
  DEMO_EMBEDDING_SPACE,
} from '../lib/demo/embeddings';

// ---- Fixed demo-space parameters (see header for the α rationale) ----------
const DEMO_TARGET_ABSTAIN_RATE = 0.45; // demo-specific budget — NOT production α
const SPLIT_SEED = 42; // same held-out-split seed convention as production
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;
const MATCH_COUNT = 6; // top-k retrieved, mirrors /api/query's MATCH_COUNT

const SCHEMA_VERSION = 1;
const PERSONA_REL = 'data/eval-benchmark/personas/synthetic-redteam-resume.md';
const PROMPTS_REL = 'data/eval-benchmark/red-team-prompts.json';
const CORPUS_REL = 'lib/demo/demo-corpus.json';
const CALIBRATION_REL = 'lib/demo/demo-calibration.json';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

function round(x: number, dp = 6): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

const roundVec = (v: readonly number[]) => v.map((x) => round(x));

async function buildArtifacts() {
  // --- Corpus: chunk the committed fictional persona (frontmatter stripped). ---
  const personaRaw = readFileSync(join(repoRoot, PERSONA_REL), 'utf8');
  const personaBody = personaRaw.replace(/^---\n[\s\S]*?\n---\n/, '');
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const chunkTexts = await splitter.splitText(personaBody);

  const idfTable = buildIdfTable(chunkTexts.map((c) => tokenize(c)));
  const idfRounded = {
    nDocs: idfTable.nDocs,
    idf: Object.fromEntries(
      Object.entries(idfTable.idf).map(([t, v]) => [t, round(v)]),
    ),
  };

  const chunks = chunkTexts.map((content, i) => ({
    id: `demo-chunk-${String(i).padStart(2, '0')}`,
    content,
    embedding: roundVec(embedDemoText(content, idfTable)),
  }));

  const corpus = {
    _label:
      'SYNTHETIC DEMO ARTIFACT — fictional persona ("Avery Patel", committed at ' +
      `${PERSONA_REL}) embedded with deterministic hash-based demo embeddings ` +
      `(${DEMO_EMBEDDING_SPACE}). NOT model embeddings; NOT a real person. ` +
      'Regenerate with: npx tsx scripts/build-demo-artifacts.ts',
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: PERSONA_REL,
    persona: 'synthetic-redteam-01 (fictional)',
    embeddingSpace: DEMO_EMBEDDING_SPACE,
    dim: DEMO_EMBEDDING_DIM,
    chunking: {
      splitter: 'RecursiveCharacterTextSplitter',
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    },
    idf: idfRounded,
    chunks,
  };

  // --- Calibration: same conformal procedure, demo space, committed prompts. ---
  // Score each prompt exactly the way the demo runtime will: embed the prompt,
  // take the top-k cosine similarities against the COMMITTED (rounded) chunk
  // vectors, and feed those to the same scoreOOD the production gate uses.
  const promptsDoc = JSON.parse(
    readFileSync(join(repoRoot, PROMPTS_REL), 'utf8'),
  ) as { prompts: Array<{ id: string; category: string; text: string }> };

  const chunkVectors = chunks.map((c) => c.embedding);
  const profiles = promptsDoc.prompts
    .filter((p) => p.text && p.text.trim().length > 0) // ec-01 excluded, as in prod
    .map((p) => {
      const sims = similaritiesTo(
        embedDemoText(p.text, idfTable),
        chunkVectors,
      ).slice(0, MATCH_COUNT);
      return { id: p.id, category: p.category, oodScore: scoreOOD(sims).score };
    });

  const n = profiles.length;
  const scores = profiles.map((p) => p.oodScore);
  const rank = conformalQuantileRank(n, DEMO_TARGET_ABSTAIN_RATE);
  const tau = splitConformalThreshold(scores, DEMO_TARGET_ABSTAIN_RATE);
  const threshold = Number.isFinite(tau) ? round(tau) : null;
  const abstained = profiles.filter(
    (p) => threshold !== null && p.oodScore > threshold,
  );

  // Held-out honesty check, mirroring scripts/calibrate-ood-gate.ts: one
  // fixed-seed 50/50 split, scored ONCE.
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

  const calibration = {
    _label:
      'SYNTHETIC DEMO ARTIFACT — τ re-derived over the deterministic demo ' +
      `embedding space (${DEMO_EMBEDDING_SPACE}) with the same split-conformal ` +
      'procedure as production (lib/quality-gates/ood-score.ts). The abstain ' +
      `budget α = ${DEMO_TARGET_ABSTAIN_RATE} is DEMO-SPECIFIC (see ` +
      'scripts/build-demo-artifacts.ts for the composition-driven rationale); ' +
      'it is NOT the production budget and these numbers say nothing about ' +
      'the production calibration (lib/quality-gates/ood-calibration.json). ' +
      'Regenerate with: npx tsx scripts/build-demo-artifacts.ts',
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: `${PROMPTS_REL} scored against ${CORPUS_REL}`,
    embeddingSpace: DEMO_EMBEDDING_SPACE,
    scoreWeights: { coverage: 0.6, centroidProximity: 0.4 },
    targetAbstainRate: DEMO_TARGET_ABSTAIN_RATE,
    n,
    conformalRank: rank,
    threshold,
    realizedAbstainRate: round(abstained.length / n, 6),
    matchCount: MATCH_COUNT,
    abstained: abstained
      .map((p) => ({ id: p.id, category: p.category, oodScore: round(p.oodScore) }))
      .sort((a, b) => b.oodScore - a.oodScore || (a.id < b.id ? -1 : 1)),
    validation: {
      seed: SPLIT_SEED,
      calSize: calHalf.length,
      valSize: valHalf.length,
      calThreshold: Number.isFinite(calTau) ? round(calTau) : null,
      valAbstainCount: valAbstained.length,
      valAbstainRate: round(valAbstained.length / valHalf.length, 6),
      valWilson95: { low: round(valWilson.low), high: round(valWilson.high) },
    },
  };

  return { corpus, calibration };
}

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

async function main() {
  const check = process.argv.includes('--check');
  const { corpus, calibration } = await buildArtifacts();

  const targets: Array<{ rel: string; data: unknown }> = [
    { rel: CORPUS_REL, data: corpus },
    { rel: CALIBRATION_REL, data: calibration },
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
        console.error(`[build-demo-artifacts] DRIFT: ${rel} is out of date.`);
      } else {
        console.log(`[build-demo-artifacts] OK: ${rel} matches derived value.`);
      }
    } else {
      writeFileSync(path, next);
      console.log(`[build-demo-artifacts] wrote ${rel}`);
    }
  }

  console.log(
    `\ndemo space: ${DEMO_EMBEDDING_SPACE} dim=${DEMO_EMBEDDING_DIM}  chunks=${corpus.chunks.length}  vocab=${Object.keys(corpus.idf.idf).length}`,
  );
  console.log(
    `demo α=${calibration.targetAbstainRate}  n=${calibration.n}  rank=${calibration.conformalRank}  τ=${calibration.threshold}  realized abstain=${calibration.realizedAbstainRate}`,
  );

  if (check && drift) process.exit(1);
}

main();
