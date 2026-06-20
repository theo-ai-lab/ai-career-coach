/**
 * quality-gates/satisficing.ts
 *
 * Satisficing stop-criterion for a critique -> revise loop.
 *
 * WHY
 * ---
 * A critique loop that runs to a fixed max-iterations count wastes LLM
 * calls polishing answers that are already good enough, and (worse) can
 * keep "improving" past the point of diminishing returns. Satisficing
 * stops as soon as the answer clears the quality bar defined by the
 * EXISTING judge rubric — not when a counter runs out.
 *
 * The rubric is lib/evals/coaching-quality.ts: an `overall` score in
 * 0..100 plus four 1..5 sub-scores (actionability, personalization,
 * honesty, grounding). This module consumes that exact shape, so the stop
 * decision is grounded in the same rubric the app already trusts.
 *
 * STOP CRITERIA (in priority order)
 * ---------------------------------
 *   1. satisficed         — overall >= overallTarget AND every safety-
 *                           critical sub-score meets its floor. The
 *                           primary, intended exit.
 *   2. diminishing-returns — improvement over the previous iteration is
 *                           below minDelta (the loop has plateaued).
 *   3. max-iterations     — hard safety backstop only (NOT the primary
 *                           criterion). Prevents an unbounded loop when the
 *                           answer never satisfices.
 *   otherwise: continue.
 *
 * The honesty + grounding floors mean a high *average* cannot mask a
 * safety-relevant weakness: an answer that is slick and actionable but
 * poorly grounded will NOT satisfice and the loop keeps going (or escalates).
 *
 * INJECTABILITY / TESTABILITY
 * ---------------------------
 * evaluateSatisficing() is a pure decision over a (mock) judge output +
 * loop state — no LLM. runSatisficingLoop() takes an injectable generate()
 * and judge() so the whole loop is exercised with deterministic mocks; the
 * real (key-requiring) judge is evaluateCoachingQuality() from
 * lib/evals/coaching-quality.ts, marked at the integration point.
 *
 * !!! UNVALIDATED DEFAULTS !!! overallTarget / sub-score floors / minDelta
 * are illustrative starting points, not calibrated values. The README
 * currently surfaces a low-confidence warning below 75; the default target
 * here (80) is deliberately a notch above that and must be tuned on real
 * eval traces before being trusted as a release gate.
 */

import type {
  CoachingQualityOutput,
  CoachingQualityScores,
} from '@/lib/evals/coaching-quality';

export interface SatisficingCriteria {
  /** Overall (0..100) at/above which the answer can satisfice. Default 80. */
  overallTarget: number;
  /**
   * Per-dimension 1..5 floors that must ALL be met to satisfice. Defaults
   * put the bar on the two safety-critical dimensions (honesty, grounding)
   * and leave the others at the minimum so `overall` governs them.
   */
  subScoreFloors: Partial<CoachingQualityScores>;
  /**
   * Minimum overall improvement vs the previous iteration to justify
   * continuing. Below this the loop is judged to have plateaued. Default 3.
   */
  minDelta: number;
  /** Hard safety backstop on iterations. Default 4. */
  maxIterations: number;
}

export const DEFAULT_SATISFICING_CRITERIA: SatisficingCriteria = {
  overallTarget: 80,
  subScoreFloors: { honesty: 4, grounding: 4 },
  minDelta: 3,
  maxIterations: 4,
};

export type StopReason =
  | 'satisficed'
  | 'diminishing-returns'
  | 'max-iterations'
  | 'continue';

export interface SatisficingDecision {
  stop: boolean;
  reason: StopReason;
  /** Did the answer clear the quality bar (overall + all floors)? */
  meetsQualityBar: boolean;
  /** Sub-score dimensions that fell below their floor (if any). */
  failedFloors: Array<keyof CoachingQualityScores>;
  /** overall - previousOverall, or null on the first iteration. */
  delta: number | null;
  explanation: string;
}

export interface LoopState {
  /** 1-based iteration index of the judgement being evaluated. */
  iteration: number;
  /** Overall score from the immediately preceding iteration, if any. */
  previousOverall?: number;
}

function resolveCriteria(
  partial?: Partial<SatisficingCriteria>,
): SatisficingCriteria {
  const c = { ...DEFAULT_SATISFICING_CRITERIA, ...partial };
  if (partial?.subScoreFloors) {
    c.subScoreFloors = { ...partial.subScoreFloors };
  }
  if (c.maxIterations < 1) {
    throw new Error('SatisficingCriteria: maxIterations must be >= 1');
  }
  return c;
}

function checkFloors(
  scores: CoachingQualityScores,
  floors: Partial<CoachingQualityScores>,
): Array<keyof CoachingQualityScores> {
  const failed: Array<keyof CoachingQualityScores> = [];
  (Object.keys(floors) as Array<keyof CoachingQualityScores>).forEach((dim) => {
    const floor = floors[dim];
    if (typeof floor === 'number' && scores[dim] < floor) failed.push(dim);
  });
  return failed;
}

/**
 * Pure stop decision for one iteration of the critique loop. Feed it the
 * judge output (mock in tests) and the loop state.
 */
export function evaluateSatisficing(
  judge: CoachingQualityOutput,
  state: LoopState,
  criteria?: Partial<SatisficingCriteria>,
): SatisficingDecision {
  const c = resolveCriteria(criteria);
  const failedFloors = checkFloors(judge.scores, c.subScoreFloors);
  const meetsOverall = judge.overall >= c.overallTarget;
  const meetsQualityBar = meetsOverall && failedFloors.length === 0;
  const delta =
    state.previousOverall === undefined
      ? null
      : judge.overall - state.previousOverall;

  // 1. Satisficed — the intended exit.
  if (meetsQualityBar) {
    return {
      stop: true,
      reason: 'satisficed',
      meetsQualityBar,
      failedFloors,
      delta,
      explanation: `Satisficed at iteration ${state.iteration}: overall ${judge.overall} >= target ${c.overallTarget} and all sub-score floors met. Stopping early (saved up to ${Math.max(0, c.maxIterations - state.iteration)} further iteration(s)).`,
    };
  }

  // 2. Diminishing returns — plateaued below the bar.
  if (delta !== null && delta < c.minDelta) {
    return {
      stop: true,
      reason: 'diminishing-returns',
      meetsQualityBar,
      failedFloors,
      delta,
      explanation: `Plateau at iteration ${state.iteration}: overall improved by ${delta} (< minDelta ${c.minDelta}) and quality bar not met${failedFloors.length ? ` (failed floors: ${failedFloors.join(', ')})` : ''}. Stopping; further iterations are unlikely to help — consider escalating to human review.`,
    };
  }

  // 3. Max-iterations safety backstop.
  if (state.iteration >= c.maxIterations) {
    return {
      stop: true,
      reason: 'max-iterations',
      meetsQualityBar,
      failedFloors,
      delta,
      explanation: `Hit max-iterations backstop (${c.maxIterations}) without satisficing${failedFloors.length ? ` (failed floors: ${failedFloors.join(', ')})` : ''}. Stopping; this answer did NOT clear the quality bar — escalate to human review.`,
    };
  }

  // Otherwise: keep going.
  return {
    stop: false,
    reason: 'continue',
    meetsQualityBar,
    failedFloors,
    delta,
    explanation: `Continuing after iteration ${state.iteration}: overall ${judge.overall} < target ${c.overallTarget}${failedFloors.length ? `, failed floors: ${failedFloors.join(', ')}` : ''}${delta !== null ? `, last delta +${delta}` : ''}.`,
  };
}

export interface SatisficingLoopResult {
  /** The final answer text produced by the loop. */
  answer: string;
  /** The judge output for the final answer. */
  finalJudge: CoachingQualityOutput;
  /** Number of generate+judge iterations actually run. */
  iterations: number;
  /** Why the loop stopped. */
  stopReason: StopReason;
  /** Did the final answer clear the quality bar? */
  meetsQualityBar: boolean;
  /** Per-iteration decision trace, for logging/debugging. */
  trace: SatisficingDecision[];
}

/**
 * Injectable answer generator. Iteration 1 produces the initial draft;
 * later iterations receive the previous answer + judge feedback to revise.
 */
export interface AnswerGenerator {
  generate(input: {
    iteration: number;
    previousAnswer?: string;
    previousJudge?: CoachingQualityOutput;
  }): Promise<string>;
}

/**
 * Injectable judge. The REAL implementation is evaluateCoachingQuality()
 * from lib/evals/coaching-quality.ts (key-requiring LLM-as-judge).
 */
export interface QualityJudge {
  evaluate(answer: string): Promise<CoachingQualityOutput>;
}

/**
 * Run a critique -> revise loop that stops on the SATISFICING criterion
 * rather than a fixed iteration count. Fully mock-testable via injected
 * generate()/judge().
 *
 * INTEGRATION (key-requiring; MARKED — not wired here):
 *   const result = await runSatisficingLoop({
 *     generator: { generate: ({previousAnswer, previousJudge}) =>
 *       llm.invoke(buildRevisePrompt(previousAnswer, previousJudge)) },
 *     judge:     { evaluate: (answer) =>
 *       evaluateCoachingQuality({ query, response: answer, contexts }) },
 *     criteria:  DEFAULT_SATISFICING_CRITERIA,
 *   });
 *   if (!result.meetsQualityBar) { ...route to HITL... }
 */
export async function runSatisficingLoop(opts: {
  generator: AnswerGenerator;
  judge: QualityJudge;
  criteria?: Partial<SatisficingCriteria>;
}): Promise<SatisficingLoopResult> {
  const c = resolveCriteria(opts.criteria);
  const trace: SatisficingDecision[] = [];

  let previousAnswer: string | undefined;
  let previousJudge: CoachingQualityOutput | undefined;
  let previousOverall: number | undefined;
  let answer = '';
  let judgeOut: CoachingQualityOutput | undefined;
  let decision: SatisficingDecision | undefined;
  let iteration = 0;

  // Bounded by the safety backstop; satisficing/plateau break earlier.
  for (iteration = 1; iteration <= c.maxIterations; iteration++) {
    answer = await opts.generator.generate({
      iteration,
      previousAnswer,
      previousJudge,
    });
    judgeOut = await opts.judge.evaluate(answer);

    decision = evaluateSatisficing(judgeOut, { iteration, previousOverall }, c);
    trace.push(decision);

    if (decision.stop) break;

    previousAnswer = answer;
    previousJudge = judgeOut;
    previousOverall = judgeOut.overall;
  }

  // After a natural for-loop exit (no break), iteration overshoots by one.
  const ranIterations = Math.min(iteration, c.maxIterations);

  return {
    answer,
    finalJudge: judgeOut!,
    iterations: ranIterations,
    stopReason: decision!.reason,
    meetsQualityBar: decision!.meetsQualityBar,
    trace,
  };
}
