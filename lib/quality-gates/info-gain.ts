/**
 * quality-gates/info-gain.ts
 *
 * Info-gain-gated re-retrieval for a critique -> retrieve loop.
 *
 * WHY
 * ---
 * In a self-correcting RAG loop, a critique step inspects the draft answer
 * and proposes a refined query ("you didn't address X; look for Y"). The
 * naive loop re-runs retrieval on every critique iteration. That re-fires
 * an embedding call + a vector-search round-trip (and any reranker call —
 * e.g. Cohere rerank — if one is later added to this pipeline) EVERY pass,
 * even when the refined query carries no new information and would return
 * the same chunks.
 *
 * This module gates re-retrieval on INFORMATION GAIN: only re-fire
 * retrieval when the critique actually changed the query's information
 * content. Otherwise reuse the prior retrieved results. That cuts the
 * per-iteration retrieval cost on the (common) passes where the critique
 * was cosmetic.
 *
 * COST NOTE (honest scope)
 * ------------------------
 * This repo's live retrieval is OpenAI `text-embedding-3-small` +
 * Supabase pgvector `match_documents_v2` (see lib/rag.ts, lib/supabase-types.ts).
 * There is NO Cohere dependency in the current stack — the gate saves the
 * embedding + pgvector round-trip per reused step, and would equally save a
 * reranker call (Cohere or otherwise) if one is wired in later. No measured
 * cost figure is claimed here; the savings are per-skipped-retrieval and
 * depend on how often critiques are cosmetic in practice.
 *
 * HOW (information content changed?)
 * ----------------------------------
 * Info gain is estimated from two complementary, mock-testable signals:
 *
 *   1. Semantic drift  = 1 - cosineSimilarity(prevQueryEmb, newQueryEmb).
 *      How far the refined query moved in embedding space. Large drift =>
 *      likely to surface different chunks => re-retrieve.
 *
 *   2. Lexical novelty = fraction of new query content-tokens NOT already
 *      present in the prior query / prior retrieved context. Captures the
 *      "the critique named a concrete new entity to look up" case even when
 *      embedding drift is modest.
 *
 * A structured critique can also FORCE retrieval (e.g. the judge flagged
 * grounding as insufficient and named missing evidence). That hard signal
 * bypasses the thresholds.
 *
 * INJECTABILITY / TESTABILITY
 * ---------------------------
 * The decision functions take embeddings/strings directly, so tests pass
 * mock vectors and mock critique signals — no embedder, DB, or key needed.
 * An optional Embedder interface + infoGainFromQueries() helper shows where
 * the real (key-requiring) embedder plugs in; tests inject a deterministic
 * mock embedder.
 *
 * !!! UNVALIDATED DEFAULTS !!! The thresholds are illustrative starting
 * points, not calibrated values. Tune against real critique traces before
 * trusting the reuse decision in production.
 */

import { cosineSimilarity, clamp } from './vector-math';

export interface InfoGainConfig {
  /**
   * Re-retrieve when combined info gain >= this threshold. UNVALIDATED
   * default: 0.25 (on a 0..1 scale).
   */
  reretrieveThreshold: number;
  /** Weight of semantic drift in the combined score. Default 0.6. */
  driftWeight: number;
  /** Weight of lexical novelty in the combined score. Default 0.4. */
  noveltyWeight: number;
}

export const DEFAULT_INFO_GAIN_CONFIG: InfoGainConfig = {
  reretrieveThreshold: 0.25,
  driftWeight: 0.6,
  noveltyWeight: 0.4,
};

/** A structured signal extracted from the critique step. */
export interface CritiqueSignal {
  /**
   * Hard override: the critique determined more/different evidence is
   * required (e.g. grounding judged insufficient, named missing facts).
   * When true, re-retrieval fires regardless of drift/novelty.
   */
  requiresMoreEvidence?: boolean;
  /** The refined query the critique produced, if any. */
  refinedQuery?: string;
  /** Concrete new info needs the critique named (entities, skills, etc.). */
  missingInfo?: string[];
}

export interface ReretrievalDecision {
  reretrieve: boolean;
  /** Combined information-gain estimate in [0, 1]. */
  infoGain: number;
  semanticDrift: number;
  lexicalNovelty: number;
  reason: string;
  /**
   * True when this decision avoided a retrieval call (reuse). Useful for a
   * cost counter. (1 saved call == 1 embedding + 1 vector search, plus any
   * reranker call if configured.)
   */
  savedRetrievalCall: boolean;
}

/** Semantic drift in [0, 2]: 1 - cosine similarity of the two query embeddings. */
export function semanticDrift(
  prevQueryEmbedding: readonly number[],
  newQueryEmbedding: readonly number[],
): number {
  return 1 - cosineSimilarity(prevQueryEmbedding, newQueryEmbedding);
}

const TOKEN_SPLIT = /[^a-z0-9]+/i;
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for',
  'with', 'is', 'are', 'be', 'this', 'that', 'it', 'as', 'at', 'by',
  'my', 'me', 'i', 'you', 'your', 'how', 'what', 'do', 'does', 'can',
]);

/** Lowercased, stopword-stripped content tokens (length >= 2). */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(TOKEN_SPLIT)) {
    if (raw.length >= 2 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/**
 * Lexical novelty in [0, 1]: fraction of the NEW query's content tokens
 * that do not appear in the prior text (prior query and/or prior retrieved
 * context concatenated). 0 => fully covered already; 1 => all-new terms.
 * An empty new query has no novel content -> 0.
 */
export function lexicalNovelty(priorText: string, newQuery: string): number {
  const newTokens = contentTokens(newQuery);
  if (newTokens.size === 0) return 0;
  const priorTokens = contentTokens(priorText);
  let novel = 0;
  for (const t of newTokens) {
    if (!priorTokens.has(t)) novel++;
  }
  return novel / newTokens.size;
}

function resolveConfig(partial?: Partial<InfoGainConfig>): InfoGainConfig {
  const cfg = { ...DEFAULT_INFO_GAIN_CONFIG, ...partial };
  if (cfg.driftWeight < 0 || cfg.noveltyWeight < 0) {
    throw new Error('InfoGainConfig: weights must be non-negative');
  }
  if (cfg.driftWeight + cfg.noveltyWeight === 0) {
    throw new Error('InfoGainConfig: driftWeight + noveltyWeight must be > 0');
  }
  return cfg;
}

/**
 * Decide whether to re-fire retrieval given precomputed signals. Pure.
 *
 * @param semanticDriftValue  semanticDrift(prevEmb, newEmb), >= 0
 * @param lexicalNoveltyValue lexicalNovelty(priorText, newQuery), [0,1]
 * @param critique            optional structured critique signal
 */
export function decideReretrieval(
  semanticDriftValue: number,
  lexicalNoveltyValue: number,
  critique?: CritiqueSignal,
  config?: Partial<InfoGainConfig>,
): ReretrievalDecision {
  const cfg = resolveConfig(config);

  // Normalise drift (clamp the [0,2] cosine-distance range into [0,1] for
  // the weighted blend; drift > 1 means the queries point in opposing
  // directions, which is already "maximally different").
  const driftNorm = clamp(semanticDriftValue, 0, 1);
  const noveltyNorm = clamp(lexicalNoveltyValue, 0, 1);

  const wSum = cfg.driftWeight + cfg.noveltyWeight;
  const infoGain =
    (cfg.driftWeight * driftNorm + cfg.noveltyWeight * noveltyNorm) / wSum;

  // Hard override from the critique.
  if (critique?.requiresMoreEvidence) {
    return {
      reretrieve: true,
      infoGain,
      semanticDrift: semanticDriftValue,
      lexicalNovelty: lexicalNoveltyValue,
      savedRetrievalCall: false,
      reason: `Critique flagged requiresMoreEvidence${critique.missingInfo?.length ? ` (missing: ${critique.missingInfo.join(', ')})` : ''}; re-retrieving regardless of info-gain score (${infoGain.toFixed(3)}).`,
    };
  }

  const reretrieve = infoGain >= cfg.reretrieveThreshold;
  return {
    reretrieve,
    infoGain,
    semanticDrift: semanticDriftValue,
    lexicalNovelty: lexicalNoveltyValue,
    savedRetrievalCall: !reretrieve,
    reason: reretrieve
      ? `Info gain ${infoGain.toFixed(3)} >= threshold ${cfg.reretrieveThreshold} (drift ${driftNorm.toFixed(3)}, novelty ${noveltyNorm.toFixed(3)}); re-firing retrieval.`
      : `Info gain ${infoGain.toFixed(3)} < threshold ${cfg.reretrieveThreshold} (drift ${driftNorm.toFixed(3)}, novelty ${noveltyNorm.toFixed(3)}); reusing prior retrieval results and saving a retrieval call.`,
  };
}

/**
 * Optional injectable embedder. The REAL implementation wraps the
 * key-requiring OpenAI embeddings client (lib/rag.ts -> getEmbeddings());
 * tests inject a deterministic mock.
 */
export interface Embedder {
  embedQuery(text: string): Promise<number[]>;
}

/**
 * Convenience: compute both signals from raw text using an injected
 * embedder, then decide. Marks exactly where the real embedder plugs in.
 *
 * INTEGRATION (key-requiring; MARKED — not wired here):
 *   Inside a critique -> retrieve loop, BEFORE re-running
 *   `embeddings.embedQuery` + `match_documents_v2`:
 *
 *     const d = await decideReretrievalForQueries(
 *       prevQuery, refinedQuery, priorContextText,
 *       getEmbeddings(),         // the real, key-requiring embedder
 *       { requiresMoreEvidence: critiqueSaysGroundingInsufficient },
 *     );
 *     const docs = d.reretrieve ? await runRetrieval(refinedQuery) : priorDocs;
 *
 *   Note this still spends ONE embedding to measure drift; the saving is the
 *   vector-search (and any reranker) round-trip plus, in a multi-iteration
 *   loop, the repeated retrievals. If even the drift-embedding is too costly,
 *   gate on lexicalNovelty + critique signal alone (no embedder).
 */
export async function decideReretrievalForQueries(
  prevQuery: string,
  newQuery: string,
  priorContextText: string,
  embedder: Embedder,
  critique?: CritiqueSignal,
  config?: Partial<InfoGainConfig>,
): Promise<ReretrievalDecision> {
  const [prevEmb, newEmb] = await Promise.all([
    embedder.embedQuery(prevQuery),
    embedder.embedQuery(newQuery),
  ]);
  const drift = semanticDrift(prevEmb, newEmb);
  const novelty = lexicalNovelty(`${prevQuery}\n${priorContextText}`, newQuery);
  return decideReretrieval(drift, novelty, critique, config);
}
