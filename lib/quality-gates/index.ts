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
 *   - ood-gate       : PRE-generation retrieval-surprise / OOD screen with a
 *                      CONFORMAL-calibrated abstention threshold (keyless)
 *   - cascade-telemetry : per-gate alpha telemetry + the suite cascade contract
 *                      (alpha / disagreementRate / losslessViolations) with
 *                      per-gate REGIME + residual LOCUS labels
 */

export * from './vector-math';
export * from './data-density';
export * from './info-gain';
export * from './satisficing';
export * from './retrieval-pipeline';
export * from './ood-gate';
export * from './cascade-telemetry';
