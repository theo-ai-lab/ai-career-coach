/**
 * grounding/types.ts
 *
 * Shared contracts for the POST-GENERATION grounding gate.
 *
 * WHAT THIS IS
 * ------------
 * The Coach already runs a PRE-generation retrieval-confidence gate
 * (data-density -> HITL). This is its complement: a POST-generation
 * output-faithfulness check. After an answer is produced we extract the
 * factual claims it makes ABOUT THE USER ("you have 5 years of Python",
 * "your resume shows leadership") and reconcile them against the retrieved
 * résumé evidence (the same RAG chunks used to ground the answer) by calling
 * Pacioli's deterministic claim-vs-evidence reconciliation engine over HTTP
 * (POST /api/reconcile).
 *
 * WHY PACIOLI, AND WHY THIS IS ON-THESIS
 * --------------------------------------
 * The red-team (data/eval-benchmark/red-team-observations.md, mr-02) showed the
 * Coach's OWN LLM-as-judge scoring a confirmed false-confirmation 85/100 — a
 * blind spot in the rubric itself. Routing the answer's claims through a SECOND,
 * INDEPENDENT reconciliation engine that does not share that rubric is exactly
 * the kind of cross-check that catches what a single judge misses.
 *
 * HONEST SCOPE (read this before trusting a "clean" result)
 * ---------------------------------------------------------
 * Pacioli is deterministic-first. Its deterministic rules fire on structural
 * over-claims (budget/scope/recurrence) and ABSTAIN on the fuzzy residual —
 * a claim that merely CONTRADICTS the evidence (CLAIM_MISMATCH). That semantic
 * residual is exactly the class a coaching fabrication falls into, and it is
 * only adjudicated by Pacioli's GATED LLM judge (Anthropic key or local
 * Ollama, behind PACIOLI_API_KEY). So:
 *   - judge active  (judgeMode local|anthropic) -> semantic mismatches checked.
 *   - judge off/unauthorized/unavailable        -> only structural over-claims
 *     checked; a "0 unsupported" is NOT a clean bill of health.
 * `GroundingResult.status` distinguishes these honestly ('clean' vs
 * 'deterministic-only'); the gate never reports a fabricated pass.
 */

/** One factual claim extracted from the Coach's answer, ready to reconcile. */
export interface ExtractedClaim {
  /** Stable id ("claim-0", ...) echoed back by Pacioli so we can map verdicts. */
  id: string;
  /** The claim text (markdown-stripped, trimmed). */
  text: string;
}

/** A single claim entry in Pacioli's batch /api/reconcile request body. */
export interface PacioliClaimEntry {
  id: string;
  agent: string;
  task: string;
  claim: string;
  /**
   * We assert no spend/scope authorization — this gate checks factual
   * grounding, not budget/scope adherence — so this is intentionally empty.
   * The deterministic engine therefore returns "supported" for any non-spend
   * claim; the semantic CLAIM_MISMATCH check is what does the real work (judge).
   */
  authorized: Record<string, never>;
}

/**
 * Pacioli's shared evidence packet. The retrieved résumé chunks are packed into
 * `items` + `excerpt`, respecting Pacioli's schema bounds (items <= 50 entries
 * x 200 chars; excerpt <= 1000 chars). `merchant` is a required label field on
 * Pacioli's side — we use it to name the evidence source ("resume").
 */
export interface PacioliEvidence {
  merchant: string;
  items: string[];
  excerpt: string;
  recurring: false;
}

/**
 * The gate's outcome, surfaced in the /api/query response payload and the UI.
 *
 *   - 'flagged'             >= 1 unsupported/over-claimed statement.
 *   - 'clean'               claims checked, none flagged, AND the semantic judge
 *                           ran (judgeMode local|anthropic) — a real pass.
 *   - 'deterministic-only'  claims checked, none structurally over-claimed, but
 *                           the semantic judge did NOT run — mismatches were not
 *                           adjudicated. Honest: NOT a clean bill of health.
 *   - 'skipped'             gate not configured, or no factual claims to check.
 *   - 'unavailable'         Pacioli unreachable / errored / returned a bad shape.
 */
export type GroundingStatus =
  | 'flagged'
  | 'clean'
  | 'deterministic-only'
  | 'skipped'
  | 'unavailable';

export type FlaggedStatus = 'unsupported' | 'overclaim';

export interface GroundingFlaggedClaim {
  /** The original claim text from the Coach's answer. */
  claim: string;
  status: FlaggedStatus;
  /** Pacioli's one-line, evidence-grounded explanation (judge or rule). */
  note: string | null;
}

export interface GroundingResult {
  status: GroundingStatus;
  /** Number of factual claims extracted and sent to Pacioli. */
  checked: number;
  /** Count of semantic CLAIM_MISMATCH verdicts (requires the gated judge). */
  unsupported: number;
  /** Count of deterministic structural over-claims. */
  overclaim: number;
  /** Pacioli's judgeMode, echoed for the honest 'clean' vs 'deterministic-only' split. */
  judgeMode: string | null;
  /** The flagged statements, for display + escalation. */
  flagged: GroundingFlaggedClaim[];
  /** Machine-readable reason for 'skipped' / 'unavailable' (logging + honesty). */
  reason: string | null;
}
