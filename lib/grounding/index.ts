/**
 * grounding/ — POST-generation output-faithfulness gate.
 *
 * Orchestrates: extract the answer's factual claims about the user -> pack the
 * retrieved résumé chunks as evidence -> reconcile via Pacioli's HTTP engine ->
 * map the per-claim verdicts into a Coach-facing GroundingResult.
 *
 * Complementary to the PRE-generation data-density / HITL gate: that one asks
 * "is there enough evidence to answer?" before generation; this one asks "does
 * the generated answer's every factual claim actually hold up against that
 * evidence?" after generation.
 *
 * The orchestrator is defensive end-to-end: an unconfigured gate, no extractable
 * claims, or an unreachable Pacioli all degrade to a clearly-labelled non-
 * blocking result. It never throws and never invents a verdict.
 */

import {
  getGroundingConfig,
  isGroundingEnabled,
  type GroundingConfig,
} from './config';
import { extractFactualClaims, buildEvidence } from './claim-extraction';
import { reconcileClaims } from './pacioli-client';
import type {
  GroundingResult,
  GroundingFlaggedClaim,
  PacioliClaimEntry,
} from './types';

export * from './types';
export * from './config';
export { extractFactualClaims, isFactualClaim, buildEvidence } from './claim-extraction';
export {
  reconcileClaims,
  ReconcileBatchResponseSchema,
  type ReconcileOutcome,
  type ReconcileBatchResponse,
} from './pacioli-client';

const SKIPPED_DISABLED: GroundingResult = {
  status: 'skipped',
  checked: 0,
  unsupported: 0,
  overclaim: 0,
  judgeMode: null,
  flagged: [],
  reason: 'not-configured',
};

export interface GroundingGateInput {
  /** The user's question (becomes each claim's `task` for Pacioli). */
  query: string;
  /** The Coach's generated answer (the source of factual claims). */
  answer: string;
  /** The retrieved résumé chunks the answer was grounded on (the evidence). */
  contexts: readonly string[];
  /** Resolved config (defaults to env). Injectable for tests. */
  config?: GroundingConfig;
  /** Optional per-session ledger partition forwarded to Pacioli. */
  sessionKey?: string;
  /** Injectable transport for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Run the grounding gate. Returns a typed result for EVERY path; never throws.
 */
export async function runGroundingGate(
  input: GroundingGateInput,
): Promise<GroundingResult> {
  const config = input.config ?? getGroundingConfig();

  // Gate disabled (no PACIOLI_RECONCILE_URL) -> skip, don't block, don't fake.
  if (!isGroundingEnabled(config)) return { ...SKIPPED_DISABLED };

  // Nothing factual to check (e.g. a pure clarifying question or refusal).
  const claims = extractFactualClaims(input.answer);
  if (claims.length === 0) {
    return {
      status: 'skipped',
      checked: 0,
      unsupported: 0,
      overclaim: 0,
      judgeMode: null,
      flagged: [],
      reason: 'no-claims',
    };
  }

  const entries: PacioliClaimEntry[] = claims.map((c) => ({
    id: c.id,
    agent: 'career-coach',
    task: input.query.slice(0, 2000),
    claim: c.text,
    authorized: {},
  }));
  const evidence = buildEvidence(input.contexts, config.evidenceLabel);

  const outcome = await reconcileClaims({
    url: config.url,
    apiKey: config.apiKey,
    judge: config.judge,
    claims: entries,
    evidence,
    timeoutMs: config.timeoutMs,
    sessionKey: input.sessionKey,
    fetchImpl: input.fetchImpl,
  });

  if (!outcome.ok) {
    return {
      status: 'unavailable',
      checked: claims.length,
      unsupported: 0,
      overclaim: 0,
      judgeMode: null,
      flagged: [],
      reason: outcome.reason,
    };
  }

  const { body } = outcome;
  const claimTextById = new Map(claims.map((c) => [c.id, c.text]));

  const flagged: GroundingFlaggedClaim[] = body.claims
    .filter((c) => c.status === 'unsupported' || c.status === 'overclaim')
    .map((c) => ({
      claim: claimTextById.get(c.id) ?? c.id,
      status: c.status as GroundingFlaggedClaim['status'],
      // Prefer the judge's evidence-grounded note, then a deterministic note.
      note: c.judgeFindings[0]?.note ?? c.findings[0]?.note ?? null,
    }));

  const unsupported = body.summary.unsupported;
  const overclaim = body.summary.overclaim;
  const judgeMode = body.judgeMode ?? null;
  // Honest split: a "clean" pass is only trustworthy when the SEMANTIC judge
  // actually ran. Otherwise only structural over-claims were checked.
  const judgeRan = judgeMode === 'local' || judgeMode === 'anthropic';

  let status: GroundingResult['status'];
  if (unsupported + overclaim > 0) status = 'flagged';
  else if (judgeRan) status = 'clean';
  else status = 'deterministic-only';

  return {
    status,
    checked: claims.length,
    unsupported,
    overclaim,
    judgeMode,
    flagged,
    reason: null,
  };
}
