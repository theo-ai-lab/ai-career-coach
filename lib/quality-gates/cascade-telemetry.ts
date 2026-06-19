/**
 * quality-gates/cascade-telemetry.ts
 *
 * Per-gate alpha telemetry + the suite-wide CASCADE-TELEMETRY CONTRACT for this
 * repo.
 *
 * THE CASCADE (cheap → expensive boundaries)
 * ------------------------------------------
 * The trustworthy-answering path is a cascade of cheap deterministic tiers in
 * front of expensive ones. Each gate decides whether the cheap tier can RESOLVE
 * an input itself or must ESCALATE to the expensive tier it guards:
 *
 *   gate            cheap tier (resolve)                 expensive tier (escalate to)
 *   ────────────    ─────────────────────────────────   ───────────────────────────
 *   ood-gate        keyless OOD screen over similarities  LLM generation
 *   data-density    automated kNN-confidence assessment   human review (HITL)
 *   info-gain       reuse prior retrieval (skip refire)   re-embed + pgvector re-retrieval
 *   satisficing     stop when answer clears the bar       another LLM generate+judge pass
 *
 * THE CONTRACT (consistent shape across the suite). For each boundary we report:
 *   - alpha               fraction the cheap tier RESOLVED without escalating
 *   - disagreementRate    when both tiers run the same input, how often the
 *                         cheap verdict differs from what the expensive tier
 *                         would have produced
 *   - losslessViolations  count of inputs where the cheap fast-path produced an
 *                         outcome the expensive tier would NOT have
 *
 * The MEASURED slice (alpha / disagreement / lossless) is computed OFFLINE with
 * ZERO model spend by replaying the committed red-team run, which recorded BOTH
 * the cheap-tier signals (retrieval similarities) AND the expensive-tier outcome
 * (LLM answer + judge scores). It lives in cascade-replay.json and is regenerated
 * by scripts/calibrate-ood-gate.ts. Only the OOD-gate → LLM-generation boundary
 * has committed dual-tier data, so it is the one with a measured lossless count;
 * the other gates expose a RUNTIME acceptance-rate counter (GateCounter) and are
 * honestly marked `losslessMeasured: false` (a lossless count for them needs a
 * replay corpus that ran both the skip and no-skip variants through the judge,
 * which is not committed — we do not fabricate it).
 *
 * REGIME + LOCUS labels: each gate is tagged with its decision REGIME
 * (deterministic / model-free vs model-based-residual vs hybrid) and the
 * residual LOCUS it points at (turn / claim / action / step / chunk).
 *
 * Pure: no DB, no key, no `server-only`. Importable from the route and fully
 * unit-testable offline.
 */

import replay from './cascade-replay.json';

export type GateId = 'ood-gate' | 'data-density' | 'info-gain' | 'satisficing';

export type GateRegime =
  /** Decision is a deterministic threshold over geometry/text — no model call. */
  | 'model-free'
  /** Decision consumes a model output (e.g. the LLM-judge score). */
  | 'model-based-residual'
  /** Deterministic rules + a gated model for the residual. */
  | 'hybrid';

/** Where in the trace the gate's residual lives. */
export type ResidualLocus = 'turn' | 'claim' | 'action' | 'step' | 'chunk';

export interface GateMeta {
  id: GateId;
  regime: GateRegime;
  locus: ResidualLocus;
  /** What "resolve" means for this gate (the cheap tier's action). */
  cheapTier: string;
  /** The expensive tier this gate gates. */
  expensiveTier: string;
  /**
   * True when a lossless-violation count for this gate is MEASURED offline from
   * committed dual-tier data. False ⇒ runtime acceptance-rate only (honest).
   */
  losslessMeasured: boolean;
}

/** The four instrumented gates on the live answer path. */
export const GATE_REGISTRY: Record<GateId, GateMeta> = {
  'ood-gate': {
    id: 'ood-gate',
    regime: 'model-free',
    locus: 'turn',
    cheapTier: 'keyless OOD screen over retrieved cosine similarities',
    expensiveTier: 'LLM generation',
    losslessMeasured: true,
  },
  'data-density': {
    id: 'data-density',
    regime: 'model-free',
    locus: 'turn',
    cheapTier: 'automated kNN-similarity confidence assessment',
    expensiveTier: 'human review (HITL)',
    losslessMeasured: false,
  },
  'info-gain': {
    id: 'info-gain',
    regime: 'model-free',
    locus: 'step',
    cheapTier: 'reuse prior retrieval when the reformulation adds no information',
    expensiveTier: 're-embedding + pgvector re-retrieval round-trip',
    losslessMeasured: false,
  },
  satisficing: {
    id: 'satisficing',
    regime: 'model-based-residual',
    locus: 'turn',
    cheapTier: 'stop the revise loop once the answer clears the quality bar',
    expensiveTier: 'another LLM generate + judge iteration',
    losslessMeasured: false,
  },
};

/** Cascade-contract triple for a cheap→expensive boundary. */
export interface CascadeSlice {
  boundary: string;
  /** Fraction the cheap/deterministic tier resolved without escalating. */
  alpha: number;
  /** Fraction escalated to the expensive tier. */
  expensiveShare: number;
  /** When both tiers run, how often the cheap verdict differs from expensive. */
  disagreementRate: number;
  /** Count of cheap resolutions the expensive tier would NOT have made. */
  losslessViolations: number;
  /** Calibration sample size the slice was measured on. */
  n: number;
}

interface ReplayArtifact {
  boundary: string;
  alpha: number;
  expensiveShare: number;
  disagreementRate: number;
  losslessViolations: number;
  n: number;
}

const REPLAY = replay as ReplayArtifact;

/**
 * The MEASURED cascade slice for the OOD-gate → LLM-generation boundary, from
 * the committed offline replay (zero model spend). This is the repo's slice of
 * the suite-wide cascade contract.
 */
export function getCascadeReplaySlice(): CascadeSlice {
  return {
    boundary: REPLAY.boundary,
    alpha: REPLAY.alpha,
    expensiveShare: REPLAY.expensiveShare,
    disagreementRate: REPLAY.disagreementRate,
    losslessViolations: REPLAY.losslessViolations,
    n: REPLAY.n,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The single recruiter-legible MEASURED sentence for the README. Built from the
 * committed replay slice so the docs and the code can never disagree.
 */
export function buildMeasuredSentence(slice: CascadeSlice = getCascadeReplaySlice()): string {
  return (
    `On the committed ${slice.n}-query red-team replay, the deterministic OOD fast path ` +
    `resolves ${pct(slice.alpha)} of queries (the clearly-off-résumé tail) before any LLM call ` +
    `with ${slice.losslessViolations} lossless violations and ${pct(slice.disagreementRate)} measured disagreement; ` +
    `the expensive LLM-generation + judge tier touches the remaining ${pct(slice.expensiveShare)}.`
  );
}

/**
 * Live per-gate acceptance-rate counter. Accumulates, per gate, how often the
 * cheap tier RESOLVED (skipped the expensive step) versus had to escalate.
 * Pure/in-memory and unit-testable; a process can keep one instance to expose a
 * running acceptance rate without any model spend.
 */
export class GateCounter {
  private readonly runs: Record<string, number> = {};
  private readonly skips: Record<string, number> = {};

  /** Record one gate decision: did the cheap tier skip the expensive step? */
  record(gate: GateId, skippedExpensiveStep: boolean): void {
    this.runs[gate] = (this.runs[gate] ?? 0) + 1;
    if (skippedExpensiveStep) this.skips[gate] = (this.skips[gate] ?? 0) + 1;
  }

  /** Acceptance rate = skips / runs for one gate (null when never run). */
  acceptanceRate(gate: GateId): { runs: number; skips: number; rate: number | null } {
    const runs = this.runs[gate] ?? 0;
    const skips = this.skips[gate] ?? 0;
    return { runs, skips, rate: runs === 0 ? null : skips / runs };
  }

  /** Acceptance rates for every gate that has been recorded. */
  snapshot(): Record<string, { runs: number; skips: number; rate: number | null }> {
    const out: Record<string, { runs: number; skips: number; rate: number | null }> = {};
    for (const id of Object.keys(GATE_REGISTRY) as GateId[]) {
      const runs = this.runs[id] ?? 0;
      if (runs > 0) out[id] = this.acceptanceRate(id);
    }
    return out;
  }
}

/** One gate's decision on a single request — the raw signal logged per turn. */
export interface GateDecision {
  gate: GateId;
  regime: GateRegime;
  locus: ResidualLocus;
  /**
   * Did the cheap tier skip the expensive step on THIS request?
   * null ⇒ the gate did not apply to this request (e.g. no re-retrieval
   * considered, or generation never reached because OOD short-circuited).
   */
  skippedExpensiveStep: boolean | null;
}

/** Build the per-gate decision for one request from the gates' raw outcomes. */
export function buildGateDecision(
  gate: GateId,
  skippedExpensiveStep: boolean | null,
): GateDecision {
  const meta = GATE_REGISTRY[gate];
  return {
    gate,
    regime: meta.regime,
    locus: meta.locus,
    skippedExpensiveStep,
  };
}

/** The per-request cascade telemetry surfaced in the /api/query signals payload. */
export interface RequestCascadeTelemetry {
  /** Per-gate decisions for this turn. */
  gates: GateDecision[];
  /** The repo's measured cascade slice (from committed offline replay). */
  measured: CascadeSlice;
}

export function summarizeRequestCascade(decisions: GateDecision[]): RequestCascadeTelemetry {
  return { gates: decisions, measured: getCascadeReplaySlice() };
}
