/**
 * quality-gates/retrieval-pipeline.ts
 *
 * Composition layer that turns the three pure gates into ONE decision over a
 * retrieval round-trip, so the live route (app/api/query/route.ts) can wire a
 * single call instead of orchestrating the gates by hand:
 *
 *   first-page retrieval  ->  data-density confidence + HITL routing
 *                         ->  info-gain-gated (optional) re-retrieval
 *
 * The caller still owns the FIRST retrieval (it already has the docs + the
 * query embedding from the existing pgvector RPC); this module reuses those,
 * computes density, and decides whether a reformulated query is worth a
 * SECOND retrieval round-trip. If it is, the injected `retrieve` runs once
 * more and the denser result wins; if not, the second round-trip is skipped
 * (a saved embedding-search call) and the original docs stand.
 *
 * INJECTABILITY / TESTABILITY
 * ---------------------------
 * `embed` and `retrieve` are injected. In production they wrap the
 * key-requiring OpenAI embeddings client and the Supabase `match_documents_v2`
 * RPC (lib/rag.ts, app/api/query/route.ts). In tests they are deterministic
 * mocks, so the whole orchestration — density classification, the info-gain
 * reuse/refire decision, and the "denser result wins" merge — is exercised
 * offline with plain `number[]` vectors and no DB, no key, no `server-only`.
 *
 * THRESHOLDS remain the UNVALIDATED defaults documented in data-density.ts /
 * info-gain.ts. This module changes the WIRING, not the calibration.
 */

import {
  estimateDensityFromNeighborSimilarities,
  type DensityAssessment,
  type DensityConfig,
} from './data-density';
import {
  semanticDrift,
  lexicalNovelty,
  decideReretrieval,
  type ReretrievalDecision,
  type InfoGainConfig,
} from './info-gain';

/** A retrieved chunk. Mirrors the live RPC row (content + cosine similarity). */
export interface RetrievedDoc {
  content: string;
  similarity: number;
}

/** Injectable embedder: text -> embedding. Real = OpenAI; mock in tests. */
export type EmbedFn = (text: string) => Promise<number[]>;

/**
 * Injectable retriever: (embedding, sourceText) -> docs. Real = pgvector RPC
 * scoped to the resume; mock in tests. `sourceText` is passed through for
 * loggability and so a mock can key off the query.
 */
export type RetrieveFn = (
  queryEmbedding: readonly number[],
  sourceText: string,
) => Promise<RetrievedDoc[]>;

export interface ReretrievalOutcome {
  /** Did the conditions even warrant considering a re-retrieval? */
  attempted: boolean;
  /** Did info-gain (or a hard critique signal) actually fire the 2nd call? */
  fired: boolean;
  /** Combined info-gain estimate, or null when no attempt was made. */
  infoGain: number | null;
  /** True when the 2nd round-trip was skipped (a saved retrieval call). */
  savedCall: boolean;
  /** True when re-retrieval produced a denser result that we adopted. */
  improved: boolean;
  /** Full decision record (null when no attempt was made). */
  decision: ReretrievalDecision | null;
}

export interface RetrievalPipelineResult {
  /** Final docs to ground the answer on (initial, or denser re-retrieved). */
  docs: RetrievedDoc[];
  /** Density assessment of the FINAL docs (drives confidence + HITL). */
  density: DensityAssessment;
  /** Density of the initial first-page docs, before any re-retrieval. */
  initialDensity: DensityAssessment;
  reretrieval: ReretrievalOutcome;
}

export interface RetrievalPipelineInput {
  /** The user's original query. */
  query: string;
  /** First-page docs the caller already retrieved (with similarities). */
  initialDocs: RetrievedDoc[];
  /** The embedding used for the first retrieval (reused to measure drift). */
  queryEmbedding: readonly number[];
  /**
   * A reformulated/expanded query to TRY if the first page is not dense. When
   * absent, equal to `query`, or empty, no re-retrieval is considered.
   */
  refinedQuery?: string;
  /** Injected embedder (real = OpenAI). Only called if a re-retrieval is considered. */
  embed: EmbedFn;
  /** Injected retriever (real = pgvector RPC). Only called if info-gain fires. */
  retrieve: RetrieveFn;
  densityConfig?: Partial<DensityConfig>;
  infoGainConfig?: Partial<InfoGainConfig>;
}

const NO_RERETRIEVAL: ReretrievalOutcome = {
  attempted: false,
  fired: false,
  infoGain: null,
  savedCall: false,
  improved: false,
  decision: null,
};

function densityOf(
  docs: readonly RetrievedDoc[],
  config?: Partial<DensityConfig>,
): DensityAssessment {
  return estimateDensityFromNeighborSimilarities(
    docs.map((d) => d.similarity),
    config,
  );
}

/**
 * Run the gate composition over a first-page retrieval.
 *
 * Re-retrieval is considered ONLY when ALL of:
 *   - a distinct, non-empty `refinedQuery` is supplied, AND
 *   - the first page has at least one doc, AND
 *   - the first page is NOT already dense (region is borderline or sparse).
 * A dense first page is, by definition, well-supported — no reason to spend a
 * second round-trip. When the first page is sparse, the critique hard-signal
 * (`requiresMoreEvidence`) is raised so info-gain re-fires as long as the
 * reformulation carries genuinely new information.
 */
export async function runRetrievalPipeline(
  input: RetrievalPipelineInput,
): Promise<RetrievalPipelineResult> {
  const initialDensity = densityOf(input.initialDocs, input.densityConfig);

  const refined = input.refinedQuery?.trim();
  const shouldConsider =
    !!refined &&
    refined !== input.query.trim() &&
    input.initialDocs.length > 0 &&
    initialDensity.region !== 'dense';

  if (!shouldConsider) {
    return {
      docs: input.initialDocs,
      density: initialDensity,
      initialDensity,
      reretrieval: NO_RERETRIEVAL,
    };
  }

  // Measure information gain of the reformulation. One embedding is spent to
  // measure drift; the saving is the vector-search round-trip (see info-gain.ts).
  const refinedEmbedding = await input.embed(refined!);
  const drift = semanticDrift(input.queryEmbedding, refinedEmbedding);
  const priorText = `${input.query}\n${input.initialDocs
    .map((d) => d.content)
    .join('\n')}`;
  const novelty = lexicalNovelty(priorText, refined!);

  const decision = decideReretrieval(
    drift,
    novelty,
    // A sparse first page genuinely lacks evidence: treat that as a hard
    // "need more" signal so a novel reformulation always re-fires.
    { requiresMoreEvidence: initialDensity.region === 'sparse' },
    input.infoGainConfig,
  );

  if (!decision.reretrieve) {
    return {
      docs: input.initialDocs,
      density: initialDensity,
      initialDensity,
      reretrieval: {
        attempted: true,
        fired: false,
        infoGain: decision.infoGain,
        savedCall: true,
        improved: false,
        decision,
      },
    };
  }

  // Re-fire retrieval with the reformulated query; keep whichever page is denser.
  const reretrievedDocs = await input.retrieve(refinedEmbedding, refined!);
  const reretrievedDensity = densityOf(reretrievedDocs, input.densityConfig);
  const improved =
    reretrievedDocs.length > 0 &&
    reretrievedDensity.meanNeighborSimilarity >
      initialDensity.meanNeighborSimilarity;

  return {
    docs: improved ? reretrievedDocs : input.initialDocs,
    density: improved ? reretrievedDensity : initialDensity,
    initialDensity,
    reretrieval: {
      attempted: true,
      fired: true,
      infoGain: decision.infoGain,
      savedCall: false,
      improved,
      decision,
    },
  };
}

/** Minimal profile shape used for query expansion (subset of memory profile). */
export interface QueryExpansionProfile {
  target_role?: string | null;
  target_companies?: string[];
  skills?: string[];
}

/**
 * Build a reformulated query by expanding the user's question with concrete,
 * already-known grounding terms from their stored profile (target role,
 * target companies, skills). This is a deterministic, key-free reformulation:
 * it gives the info-gain gate something to evaluate WITHOUT an extra LLM call.
 *
 * Returns the original query unchanged when there is nothing to add (e.g. no
 * profile, or every profile term already appears in the query). In that case
 * the pipeline correctly declines to re-retrieve (zero info gain).
 */
export function expandQueryWithProfile(
  query: string,
  profile: QueryExpansionProfile | null | undefined,
): string {
  if (!profile) return query;

  const lowerQuery = query.toLowerCase();
  const terms: string[] = [];
  const add = (value?: string | null) => {
    const t = value?.trim();
    if (t && !lowerQuery.includes(t.toLowerCase())) terms.push(t);
  };

  add(profile.target_role);
  for (const company of profile.target_companies ?? []) add(company);
  for (const skill of profile.skills ?? []) add(skill);

  if (terms.length === 0) return query;
  // De-duplicate while preserving order.
  const unique = [...new Set(terms)];
  return `${query} ${unique.join(' ')}`.trim();
}
