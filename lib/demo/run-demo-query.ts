/**
 * demo/run-demo-query.ts
 *
 * The keyless DEMO-MODE answer pipeline behind /api/demo/query and /demo.
 *
 * WHAT IS REAL vs WHAT IS CANNED
 * ------------------------------
 * REAL (the same pure gate code the live route wires, executing over the demo
 * embedding space):
 *   - retrieval: cosine top-k against the committed demo corpus vectors;
 *   - the pre-generation OOD gate (decideOOD) with the demo τ, re-derived by
 *     the same split-conformal procedure as production;
 *   - the data-density confidence assessment + HITL routing, combined with
 *     the production keyword high-stakes gate (detectHighStakes);
 *   - the retrieval-pipeline composition (info-gain re-retrieval is considered
 *     exactly as in production; with no stored profile there is never a
 *     distinct reformulation, so it correctly never fires — same as the live
 *     route's skipMemory behavior).
 *
 * SYNTHETIC / CANNED (all labeled in the response payload AND in the UI):
 *   - the embedding space (lib/demo/embeddings.ts — deterministic hashed
 *     tf-idf, NOT model embeddings);
 *   - the corpus (a committed FICTIONAL persona);
 *   - the answer text: a canned completion for the scripted queries, a
 *     verbatim-excerpt extractive fallback for anything else. NO generation
 *     model, NO judge, NO network call anywhere in demo mode — which is also
 *     why `scores` is always null and the satisficing/grounding signals are
 *     null: those tiers need models, and demo mode does not fake them.
 *
 * Pure + keyless: no DB, no env vars, no `server-only`. Fully unit-testable.
 */

import {
  decideOOD,
  OOD_ABSTAIN_MESSAGE,
  runRetrievalPipeline,
  routeForHitl,
  estimateDensityFromNeighborSimilarities,
  cosineSimilarity,
  type OODCalibration,
  type OODDecision,
  type RetrievedDoc,
  type DensityConfig,
  type ReretrievalOutcome,
} from '@/lib/quality-gates';
import { detectHighStakes } from '@/lib/hitl-detection';
import {
  embedDemoText,
  type DemoIdfTable,
} from './embeddings';
import {
  matchScriptedQuery,
  DEMO_MODE_LABEL,
  type DemoGenerationKind,
} from './scripted-queries';
import demoCorpus from './demo-corpus.json';
import demoCalibration from './demo-calibration.json';

export { DEMO_MODE_LABEL } from './scripted-queries';

/** Top-k retrieved chunks — mirrors /api/query's MATCH_COUNT. */
export const DEMO_MATCH_COUNT = 6;

/**
 * Demo-space density operating points. The production defaults (0.30 / 0.60,
 * data-density.ts) are documented as unvalidated AND are scaled to the model
 * embedding space; they do not transfer to the demo space, where similarities
 * are lexical-overlap cosines. These values are demo-space choices read off
 * the committed demo replay: the sparse floor (0.05) sits above the hash-noise
 * scale of the space (~1/sqrt(1024) per pair, so a top-5 mean of pure noise
 * stays below it), and the dense ceiling (0.12) is the level the
 * vocabulary-grounded scripted queries actually reach (measured 0.125–0.175).
 * Demo operating points only — they say nothing about production thresholds.
 */
export const DEMO_DENSITY_CONFIG: DensityConfig = {
  k: 5,
  sparseSimilarity: 0.05,
  denseSimilarity: 0.12,
};

/** Per-response provenance descriptions keyed by how the answer was produced. */
export const DEMO_GENERATION_NOTES: Record<DemoGenerationKind, string> = {
  canned: 'canned demo answer — authored for this scripted query, no model call',
  extractive:
    'extractive demo answer — verbatim demo-résumé excerpts, no model call',
  'gate-abstention':
    'deterministic gate abstention — the OOD gate declined before any answer',
};

const CALIBRATION = demoCalibration as OODCalibration;
const IDF_TABLE: DemoIdfTable = demoCorpus.idf;
const CHUNKS: Array<{ id: string; content: string; embedding: number[] }> =
  demoCorpus.chunks;

export interface DemoQueryResult {
  answer: string;
  sources: Array<{ content: string; similarity: number }>;
  /** Always null: there is no LLM-as-judge in demo mode, and we don't fake one. */
  scores: null;
  demo: {
    label: string;
    corpus: string;
    embeddings: string;
    generation: DemoGenerationKind;
    generationNote: string;
    scriptedQueryId: string | null;
  };
  signals: {
    confidence: number;
    region: 'dense' | 'borderline' | 'sparse';
    meanSimilarity: number;
    hitl: { routeToHuman: boolean; triggers: string[]; reason: string };
    reretrieval: ReretrievalOutcome;
    /** Always null in demo mode (needs the generation + judge tier). */
    satisficing: null;
    /** Always null in demo mode (needs the reconciliation peer). */
    grounding: null;
    ood: {
      abstained: boolean;
      score: number;
      threshold: number | null;
      targetAbstainRate: number;
      coverage: number;
      centroidProximity: number;
      margin: number;
    };
  };
}

const NO_RERETRIEVAL: ReretrievalOutcome = {
  attempted: false,
  fired: false,
  infoGain: null,
  savedCall: false,
  improved: false,
  decision: null,
};

const CORPUS_NOTE = `fictional persona ("Avery Patel") — ${demoCorpus.generatedFrom}`;
const EMBEDDINGS_NOTE = `deterministic demo embeddings (${demoCorpus.embeddingSpace}) — not model embeddings`;

function demoMeta(
  generation: DemoGenerationKind,
  scriptedQueryId: string | null,
): DemoQueryResult['demo'] {
  return {
    label: DEMO_MODE_LABEL,
    corpus: CORPUS_NOTE,
    embeddings: EMBEDDINGS_NOTE,
    generation,
    generationNote: DEMO_GENERATION_NOTES[generation],
    scriptedQueryId,
  };
}

function oodSignal(ood: OODDecision, abstained: boolean) {
  return {
    abstained,
    score: ood.score,
    threshold: ood.threshold,
    targetAbstainRate: ood.targetAbstainRate,
    coverage: ood.coverage,
    centroidProximity: ood.centroidProximity,
    margin: ood.margin,
  };
}

/** Cosine top-k retrieval against the committed demo corpus vectors. */
export function retrieveDemoDocs(
  queryEmbedding: readonly number[],
): RetrievedDoc[] {
  return CHUNKS.map((c) => ({
    content: c.content,
    similarity: cosineSimilarity(queryEmbedding, c.embedding),
  }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, DEMO_MATCH_COUNT);
}

/**
 * The honest fallback for a free-typed, non-abstained query: demo mode has no
 * model, so instead of pretending to generate we return the strongest
 * retrieved evidence verbatim, labeled as exactly that.
 */
function buildExtractiveAnswer(docs: readonly RetrievedDoc[]): string {
  const excerpts = docs
    .slice(0, 2)
    .map((d) => `> ${d.content.replace(/\n+/g, ' ').trim()}`)
    .join('\n\n');
  return (
    'Demo mode has no generation model, so I won\'t write a fresh answer to ' +
    'that. The retrieval and quality gates did run for real on your question; ' +
    'here is the strongest evidence they found in the demo résumé:\n\n' +
    `${excerpts}\n\n` +
    'The three scripted questions have authored answers if you want to see ' +
    'the full response path.'
  );
}

/**
 * Run one query through the keyless demo pipeline. Caller validates that
 * `query` is a non-empty string (mirroring /api/query's input boundary).
 */
export async function runDemoQuery(query: string): Promise<DemoQueryResult> {
  const queryEmbedding = embedDemoText(query, IDF_TABLE);
  const firstPage = retrieveDemoDocs(queryEmbedding);

  // PRE-GENERATION OOD GATE — the real decideOOD with the demo calibration.
  const ood = decideOOD(
    firstPage.map((d) => d.similarity),
    CALIBRATION,
  );
  if (ood.abstain) {
    const density = estimateDensityFromNeighborSimilarities(
      firstPage.map((d) => d.similarity),
      DEMO_DENSITY_CONFIG,
    );
    return {
      answer: OOD_ABSTAIN_MESSAGE,
      sources: [],
      scores: null,
      demo: demoMeta('gate-abstention', matchScriptedQuery(query)?.id ?? null),
      signals: {
        confidence: density.confidence,
        region: density.region,
        meanSimilarity: density.meanNeighborSimilarity,
        hitl: {
          // Same contract as the live route: an honest deterministic
          // non-answer needs no human review.
          routeToHuman: false,
          triggers: ['off-resume-ood'],
          reason: ood.reason,
        },
        reretrieval: NO_RERETRIEVAL,
        satisficing: null,
        grounding: null,
        ood: oodSignal(ood, true),
      },
    };
  }

  // DENSITY + HITL via the same composition the live route uses. There is no
  // stored profile in demo mode, so the refined query equals the original and
  // the pipeline correctly never considers a re-retrieval (skipMemory parity).
  const pipeline = await runRetrievalPipeline({
    query,
    refinedQuery: query,
    initialDocs: firstPage,
    queryEmbedding,
    embed: async (text) => embedDemoText(text, IDF_TABLE),
    retrieve: async (emb) => retrieveDemoDocs(emb),
    densityConfig: DEMO_DENSITY_CONFIG,
  });

  const hitl = routeForHitl(pipeline.density, detectHighStakes(query));

  const scripted = matchScriptedQuery(query);
  const generation: DemoGenerationKind = scripted?.cannedAnswer
    ? 'canned'
    : 'extractive';
  const answer = scripted?.cannedAnswer ?? buildExtractiveAnswer(pipeline.docs);

  return {
    answer,
    sources: pipeline.docs.map((d) => ({
      content: d.content,
      similarity: d.similarity,
    })),
    scores: null,
    demo: demoMeta(generation, scripted?.id ?? null),
    signals: {
      confidence: pipeline.density.confidence,
      region: pipeline.density.region,
      meanSimilarity: pipeline.density.meanNeighborSimilarity,
      hitl: {
        routeToHuman: hitl.routeToHuman,
        triggers: hitl.triggers as string[],
        reason: hitl.reason,
      },
      reretrieval: pipeline.reretrieval,
      satisficing: null,
      grounding: null,
      ood: oodSignal(ood, false),
    },
  };
}
