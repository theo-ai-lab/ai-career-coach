/**
 * quality-gates/data-density.ts
 *
 * Data-density-aware "antibody" confidence + HITL routing.
 *
 * WHY
 * ---
 * RAG coaching is only trustworthy where the corpus actually has support
 * for the question. When a query lands in a SPARSE region of the embedding
 * space — far from any resume chunk the system has indexed — the model is
 * extrapolating, not grounding. The existing pipeline still answers
 * "concisely, professionally, and confidently" (see the system prompt in
 * app/api/query/route.ts), which is exactly when an over-confident
 * hallucination is most likely and most costly.
 *
 * The "antibody" metaphor: the system keeps an immune memory of where it
 * has dense support (the corpus). A query that sits far from all known
 * support triggers a low-confidence antibody response — instead of
 * confidently advising, we lower the stated confidence and route to the
 * existing human-in-the-loop (HITL) gate.
 *
 * HOW (local data density via kNN)
 * ---------------------------------
 * Local density is estimated from the cosine similarity of the query to its
 * k nearest corpus neighbours. High mean kNN similarity => the query is
 * surrounded by relevant evidence (dense). Low mean kNN similarity => the
 * query is an outlier (sparse) => extrapolation risk.
 *
 * Two entry points, same math, different cost profiles:
 *
 *   1. estimateDensityFromNeighborSimilarities(similarities, opts)
 *      The ZERO-EXTRA-COST production path. The live retrieval RPC
 *      (`match_documents_v2`) ALREADY returns a `similarity` per chunk
 *      (see lib/supabase-types.ts -> MatchDocumentsResult). Feed those
 *      straight in; no extra embedding or DB call is needed.
 *
 *   2. estimateDensityFromVectors(queryEmbedding, corpusVectors, k, opts)
 *      Self-contained path that computes kNN cosine similarity in-module
 *      from raw vectors. Used (a) in unit tests with mock vectors, and
 *      (b) if you ever want to probe a held-out reference corpus rather
 *      than the per-resume scoped chunks.
 *
 * INJECTABILITY / TESTABILITY
 * ---------------------------
 * Nothing here imports the DB, OpenAI, or `server-only`. The optional
 * NeighborProbe interface lets a caller plug in the real (key-requiring)
 * retrieval store; tests pass a mock probe or precomputed similarities.
 *
 * !!! UNVALIDATED DEFAULTS !!!
 * The thresholds below (sparseSimilarity, denseSimilarity) are ILLUSTRATIVE
 * starting points, NOT measured/calibrated values. They MUST be calibrated
 * against the real embedding distribution of the corpus before the routing
 * decision is trusted in production. A mock proves the plumbing, not a
 * tuned operating point.
 */

import { kNearestSimilarities, mean, clamp } from './vector-math';

export type DensityRegion = 'dense' | 'borderline' | 'sparse';

export interface DensityConfig {
  /** Number of nearest neighbours to average. Default 5. */
  k: number;
  /**
   * Mean-kNN-similarity at or below which the query is treated as SPARSE
   * (confidence floored, route to HITL). UNVALIDATED default: 0.30.
   */
  sparseSimilarity: number;
  /**
   * Mean-kNN-similarity at or above which the query is treated as DENSE
   * (full confidence, no density-driven escalation). UNVALIDATED: 0.60.
   */
  denseSimilarity: number;
}

export const DEFAULT_DENSITY_CONFIG: DensityConfig = {
  k: 5,
  sparseSimilarity: 0.3,
  denseSimilarity: 0.6,
};

export interface DensityAssessment {
  /** Mean cosine similarity of the k nearest corpus neighbours. */
  meanNeighborSimilarity: number;
  /** Number of neighbours actually used (min(k, corpus size)). */
  neighborsUsed: number;
  /** Confidence multiplier in [0, 1] derived from local density. */
  confidence: number;
  region: DensityRegion;
  /**
   * Density-driven recommendation to route to the human-in-the-loop gate.
   * True when the query sits in a sparse region (confidence floored).
   */
  routeToHITL: boolean;
  /** Human-readable explanation, safe to log. */
  reason: string;
}

/**
 * Optional injectable retrieval store. The REAL implementation wraps the
 * key-requiring pgvector RPC; a mock returns canned similarities in tests.
 *
 * @returns cosine similarities (descending) of the k nearest corpus
 *          vectors to the query embedding.
 */
export interface NeighborProbe {
  nearestSimilarities(
    queryEmbedding: readonly number[],
    k: number,
  ): Promise<number[]>;
}

function resolveConfig(partial?: Partial<DensityConfig>): DensityConfig {
  const cfg = { ...DEFAULT_DENSITY_CONFIG, ...partial };
  if (cfg.sparseSimilarity >= cfg.denseSimilarity) {
    throw new Error(
      `DensityConfig: sparseSimilarity (${cfg.sparseSimilarity}) must be < denseSimilarity (${cfg.denseSimilarity})`,
    );
  }
  return cfg;
}

/**
 * Map mean neighbour similarity -> confidence in [0, 1] via a clamped
 * linear ramp between the sparse floor (0) and dense ceiling (1).
 */
function densityToConfidence(meanSim: number, cfg: DensityConfig): number {
  const span = cfg.denseSimilarity - cfg.sparseSimilarity;
  const raw = (meanSim - cfg.sparseSimilarity) / span;
  return clamp(raw, 0, 1);
}

function classify(meanSim: number, cfg: DensityConfig): DensityRegion {
  if (meanSim <= cfg.sparseSimilarity) return 'sparse';
  if (meanSim >= cfg.denseSimilarity) return 'dense';
  return 'borderline';
}

/**
 * Core assessment from a list of neighbour similarities (the kNN
 * *similarities*, in any order). This is the shared kernel used by both
 * public entry points.
 */
export function estimateDensityFromNeighborSimilarities(
  similarities: readonly number[],
  config?: Partial<DensityConfig>,
): DensityAssessment {
  const cfg = resolveConfig(config);

  // No neighbours at all == maximally sparse == always escalate.
  if (similarities.length === 0) {
    return {
      meanNeighborSimilarity: 0,
      neighborsUsed: 0,
      confidence: 0,
      region: 'sparse',
      routeToHITL: true,
      reason:
        'No corpus neighbours returned for this query; treating as maximally sparse and routing to human review.',
    };
  }

  // Use the strongest k similarities as the kNN set.
  const topK = [...similarities].sort((a, b) => b - a).slice(0, cfg.k);
  const meanSim = mean(topK);
  const region = classify(meanSim, cfg);
  const confidence = densityToConfidence(meanSim, cfg);
  const routeToHITL = region === 'sparse';

  const reason =
    region === 'sparse'
      ? `Query is in a SPARSE region of the corpus (mean top-${topK.length} similarity ${meanSim.toFixed(3)} <= sparse floor ${cfg.sparseSimilarity}). Lowering confidence and routing to human review instead of advising confidently.`
      : region === 'dense'
        ? `Query is in a DENSE region (mean top-${topK.length} similarity ${meanSim.toFixed(3)} >= dense ceiling ${cfg.denseSimilarity}). Full confidence; no density-driven escalation.`
        : `Query is in a BORDERLINE region (mean top-${topK.length} similarity ${meanSim.toFixed(3)}). Confidence scaled to ${confidence.toFixed(3)}.`;

  return {
    meanNeighborSimilarity: meanSim,
    neighborsUsed: topK.length,
    confidence,
    region,
    routeToHITL,
    reason,
  };
}

/**
 * Self-contained path: compute kNN cosine similarity in-module from raw
 * vectors. Pure and fully mock-testable (pass mock query + corpus vectors).
 */
export function estimateDensityFromVectors(
  queryEmbedding: readonly number[],
  corpusVectors: readonly (readonly number[])[],
  config?: Partial<DensityConfig>,
): DensityAssessment {
  const cfg = resolveConfig(config);
  if (corpusVectors.length === 0) {
    return estimateDensityFromNeighborSimilarities([], cfg);
  }
  const sims = kNearestSimilarities(queryEmbedding, corpusVectors, cfg.k);
  return estimateDensityFromNeighborSimilarities(sims, cfg);
}

/**
 * Async path using an injectable NeighborProbe (real store or mock).
 *
 * INTEGRATION (key-requiring; MARKED — not wired here):
 *   In app/api/query/route.ts the RPC already returns `docs` with a
 *   `similarity` field. The cheapest wiring needs NO probe at all:
 *
 *     const density = estimateDensityFromNeighborSimilarities(
 *       docs.map((d) => d.similarity),
 *     );
 *     if (density.routeToHITL) { ...surface HITL banner / lower confidence... }
 *
 *   Use this probe form only when you want a dedicated kNN call against a
 *   reference corpus separate from the per-resume retrieval.
 */
export async function assessQueryDensity(
  queryEmbedding: readonly number[],
  probe: NeighborProbe,
  config?: Partial<DensityConfig>,
): Promise<DensityAssessment> {
  const cfg = resolveConfig(config);
  const sims = await probe.nearestSimilarities(queryEmbedding, cfg.k);
  return estimateDensityFromNeighborSimilarities(sims, cfg);
}

export interface HitlRoutingDecision {
  routeToHuman: boolean;
  /** Confidence to surface in the UI (density-derived, 0..1). */
  confidence: number;
  density: DensityAssessment;
  /** Which signal(s) triggered the escalation. */
  triggers: Array<'sparse-data-density' | 'high-stakes-keyword'>;
  reason: string;
}

/**
 * Combine the density signal with the EXISTING keyword HITL gate
 * (lib/hitl-detection.ts -> detectHighStakes / detectHighStakesInData).
 *
 * This is the additive bridge to the existing gate: the keyword detector
 * stays the source of truth for "high-stakes topic"; the density gate adds
 * "we don't have the evidence to answer this confidently". Either one
 * routes to a human. `keywordHighStakes` is passed in (not imported) so
 * this stays pure and unit-testable without the route handlers.
 */
export function routeForHitl(
  density: DensityAssessment,
  keywordHighStakes: boolean,
): HitlRoutingDecision {
  const triggers: HitlRoutingDecision['triggers'] = [];
  if (density.routeToHITL) triggers.push('sparse-data-density');
  if (keywordHighStakes) triggers.push('high-stakes-keyword');

  const routeToHuman = triggers.length > 0;
  const reason = routeToHuman
    ? `Routing to human review (${triggers.join(' + ')}). ${density.reason}`
    : `No escalation: dense-enough support and no high-stakes keywords. ${density.reason}`;

  return {
    routeToHuman,
    confidence: density.confidence,
    density,
    triggers,
    reason,
  };
}
