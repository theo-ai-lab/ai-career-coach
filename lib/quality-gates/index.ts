/**
 * quality-gates — additive, mock-testable reliability gates for the
 * RAG / critique pipeline. None of these import the DB, OpenAI, or
 * `server-only`; every key-requiring integration point is injectable and
 * marked in the module it lives in.
 *
 *   - vector-math    : pure cosine/kNN helpers (shared)
 *   - data-density   : "antibody" confidence + HITL routing on sparse data
 *   - info-gain      : info-gain-gated re-retrieval (skips redundant calls)
 *   - satisficing    : stop the critique loop when "good enough", not on a
 *                      fixed iteration cap
 *   - retrieval-pipeline : composition of the gates into one decision over a
 *                      retrieval round-trip, wired into app/api/query/route.ts
 */

export * from './vector-math';
export * from './data-density';
export * from './info-gain';
export * from './satisficing';
export * from './retrieval-pipeline';
