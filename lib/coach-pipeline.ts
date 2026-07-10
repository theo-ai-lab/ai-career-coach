/**
 * coach-pipeline.ts
 *
 * The /api/query answer pipeline (validate -> honesty gates -> retrieve ->
 * OOD gate -> density/HITL + info-gain -> satisficing generate/judge loop ->
 * eval persistence -> grounding gate -> response assembly) as an injectable
 * module. The route stays a thin adapter; everything decision-shaped lives
 * here and is unit-testable offline, matching the upload-pipeline and
 * quality-gates pattern (every external dependency — config, liveness probe,
 * embeddings, pgvector RPC, LLM, judge, memory, eval store, grounding — is
 * injected).
 *
 * WHY THIS EXISTS
 * ---------------
 * The route used to be a 611-line handler that could only be exercised over
 * HTTP with real keys, so none of its honesty semantics were locked by
 * tests. The extraction exists to lock them — above all the RPC-error
 * branch: a retrieval RPC failure is a SERVICE failure (503 through the
 * designed notice surface + reportBackendDead), never an HTTP 200
 * "No relevant experience found." that dresses a dead backend up as an
 * honest empty retrieval. lib/coach-pipeline.test.ts holds that regression
 * lock; the route can no longer silently reintroduce the masked failure.
 *
 * The pipeline returns { status, body } pairs — the exact HTTP contract the
 * route serves — so the tests are route-level contract tests without HTTP.
 */

import { randomUUID } from 'crypto';

import {
  runRetrievalPipeline,
  expandQueryWithProfile,
  routeForHitl,
  runSatisficingLoop,
  DEFAULT_SATISFICING_CRITERIA,
  estimateDensityFromNeighborSimilarities,
  decideOOD,
  OOD_ABSTAIN_MESSAGE,
  GateCounter,
  buildGateDecision,
  summarizeRequestCascade,
  type RetrievedDoc,
  type AnswerGenerator,
  type QualityJudge,
  type StopReason,
  type OODDecision,
  type GateDecision,
  type RequestCascadeTelemetry,
  type HitlRoutingDecision,
  type ReretrievalOutcome,
} from './quality-gates';
import { detectHighStakes } from './hitl-detection';
import {
  SERVICE_UNAVAILABLE_PAYLOAD,
  type ServiceConfig,
} from './service-config';
import {
  BACKEND_UNAVAILABLE_PAYLOAD,
  type LivenessResult,
} from './backend-liveness';
import type { CoachingQualityOutput } from './evals/coaching-quality';
import type { MemoryContext } from './memory';
import type { GroundingResult } from './grounding/types';

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export interface ChatTurn {
  role: string;
  content: string;
}

export interface CoachRequest {
  query: string;
  resumeId: string;
  sessionId: string | null;
  /**
   * Optional EXPLICIT stable identity claim. When present, memory (profile +
   * session summaries) is scoped to `user:<userId>` and persists across
   * conversations. When absent — the default — memory is scoped to the
   * conversation (`session:<resumeId>:<sessionId>`), so nothing written in
   * one conversation can leak into another (red-team 2026-05-11 finding #3).
   */
  userId: string | null;
  messages: ChatTurn[] | null;
  /** Eval/benchmark mode: stateless memory, no expansion, single draft. */
  skipMemory: boolean;
}

export type CoachRequestValidation =
  | { ok: true; request: CoachRequest }
  | { ok: false; error: string };

/**
 * Validate the POST /api/query body. Every rejection is a designed 400
 * reason (the shapes shipped since the red-team ec-01 fix), never a throw.
 */
export function parseCoachRequest(body: unknown): CoachRequestValidation {
  const record =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const { query, resumeId, sessionId, userId, messages, skipMemory } = record;

  if (!resumeId || typeof resumeId !== 'string') {
    return { ok: false, error: 'resumeId required' };
  }

  // Reject empty input. Red-team ec-01 (2026-05-11) showed an empty query
  // was embedded, retrieved against, and used to ground a fabricated
  // response — the route had no input boundary validation.
  if (typeof query !== 'string' || query.trim().length === 0) {
    return { ok: false, error: 'query required' };
  }

  return {
    ok: true,
    request: {
      query,
      resumeId,
      sessionId:
        typeof sessionId === 'string' && sessionId.length > 0
          ? sessionId
          : null,
      userId:
        typeof userId === 'string' && userId.length > 0 ? userId : null,
      messages: Array.isArray(messages) ? (messages as ChatTurn[]) : null,
      skipMemory: skipMemory === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

export interface MatchDocumentsInput {
  embedding: readonly number[];
  matchCount: number;
  resumeId: string;
}

/** Mirrors the Supabase RPC result surface the pipeline consumes. */
export interface MatchDocumentsOutput {
  data: Array<{ content: string; similarity: number }> | null;
  error: { message?: string } | null;
}

export interface CoachEvalRecord {
  response_id: string;
  query: string;
  response: string;
  contexts: string[];
  scores: CoachingQualityOutput['scores'];
  reasoning: string;
  overall_score: number;
}

export interface CoachPipelineDeps {
  /** Env presence check (lib/service-config in production). */
  getConfig(): ServiceConfig;
  /** Cached backend reachability probe (lib/backend-liveness-server). */
  checkLiveness(): Promise<LivenessResult>;
  /** Flip the shared liveness cache after an observed mid-request failure. */
  reportBackendDead(): void;
  /** Query text -> embedding (the OpenAI embeddings client). */
  embedQuery(text: string): Promise<number[]>;
  /** Scoped pgvector retrieval (the match_documents_v2 RPC). */
  matchDocuments(input: MatchDocumentsInput): Promise<MatchDocumentsOutput>;
  /** Prompt -> answer text (the chat LLM). */
  generate(prompt: string): Promise<string>;
  /** LLM-as-judge over a candidate answer. */
  judge(input: {
    query: string;
    response: string;
    contexts: string[];
  }): Promise<CoachingQualityOutput>;
  /**
   * Load profile + recent session summaries for a memory key. The pipeline
   * computes the key (conversation-scoped by default, `user:<id>` on an
   * explicit claim) — see the MEMORY SCOPING block in runCoachPipeline.
   */
  getMemoryContext(memoryKey: string): Promise<MemoryContext>;
  /** Fire-and-forget session summarization, written under the same key. */
  summarizeSession(
    memoryKey: string,
    sessionId: string,
    messages: ChatTurn[],
  ): void;
  /** Best-effort eval persistence; failures must never break the answer. */
  storeEval(record: CoachEvalRecord): Promise<void>;
  /** Post-generation grounding gate (never expected to throw). */
  ground(input: {
    query: string;
    answer: string;
    contexts: string[];
    sessionKey: string;
  }): Promise<GroundingResult | null>;
  /** Per-instance gate-acceptance tally (owned by the route module). */
  gateCounter: GateCounter;
  /** Injectable id source for deterministic tests. Defaults to randomUUID. */
  newSessionId?: () => string;
  /** Injectable logger (console in production; silent in tests). */
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
}

// ---------------------------------------------------------------------------
// Response contract
// ---------------------------------------------------------------------------

export interface CoachSignals {
  confidence: number;
  region: string;
  meanSimilarity: number;
  hitl: {
    routeToHuman: boolean;
    triggers: string[];
    reason: string;
  };
  reretrieval: ReretrievalOutcome;
  satisficing: {
    iterations: number;
    stopReason: StopReason;
    meetsQualityBar: boolean;
  } | null;
  grounding: GroundingResult | null;
  ood: {
    abstained: boolean;
    score: number;
    threshold: number | null;
    targetAbstainRate: number;
    coverage: number;
    centroidProximity: number;
    margin: number | null;
  } | null;
  cascade: RequestCascadeTelemetry;
}

export interface CoachAnswerBody {
  answer: string;
  sources: Array<{ content: string; similarity: number }>;
  sessionId: string;
  scores: {
    overall: number;
    actionability: number;
    personalization: number;
    honesty: number;
    grounding: number;
  } | null;
  signals: CoachSignals;
}

export type CoachPipelineResult =
  | { kind: 'invalid-request'; status: 400; body: { error: string } }
  | {
      kind: 'service-unavailable';
      status: 503;
      body: typeof SERVICE_UNAVAILABLE_PAYLOAD;
    }
  | {
      kind: 'backend-unavailable';
      status: 503;
      body: typeof BACKEND_UNAVAILABLE_PAYLOAD;
    }
  | { kind: 'answered'; status: 200; body: CoachAnswerBody };

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Build the revision prompt for a satisficing iteration > 1. Carries the
 * previous draft + judge feedback and instructs the model to address the weak
 * dimensions WITHOUT fabricating to inflate the score (the judge rewards
 * honest acknowledgement of gaps, so this stays aligned with grounding).
 */
function buildRevisePrompt(
  basePrompt: string,
  previousAnswer: string,
  previousJudge: CoachingQualityOutput,
): string {
  const weak = (
    Object.entries(previousJudge.scores) as Array<[string, number]>
  )
    .filter(([, v]) => v < 4)
    .map(([k]) => k);

  return `${basePrompt}

REVISION PASS
A previous draft scored ${previousJudge.overall}/100 against the coaching-quality rubric${
    weak.length ? ` and was weak on: ${weak.join(', ')}` : ''
  }. Judge feedback: ${previousJudge.reasoning}

PREVIOUS DRAFT:
${previousAnswer}

Revise the answer to address that feedback while staying strictly grounded in the candidate context above. Do NOT invent details to raise the score — if the context genuinely does not support a stronger answer, acknowledge the limitation honestly instead of fabricating.`;
}

/** Grounded system prompt: retrieved context + memory + style guidance. */
function buildSystemPrompt(
  context: string,
  memoryContext: MemoryContext,
  query: string,
): string {
  let systemPrompt = `You are an expert AI career coach helping candidates land their dream roles.

Use ONLY the following context from the candidate's background:

${context}`;

  // Inject memory context if available
  if (memoryContext.formattedContext) {
    systemPrompt += `\n\n## What You Remember About This User\n${memoryContext.formattedContext}`;
  }

  // Add communication style guidance
  if (memoryContext.profile?.communication_style === 'direct') {
    systemPrompt += '\n\nBe direct and concise in your feedback.';
  } else if (memoryContext.profile?.communication_style === 'encouraging') {
    systemPrompt += '\n\nBe supportive and encouraging while giving feedback.';
  } else {
    systemPrompt += '\n\nBalance honesty with encouragement.';
  }

  // Add natural memory reference instructions
  if (memoryContext.profile || memoryContext.recentSessions.length > 0) {
    systemPrompt += `\n\nIf you have memory of previous conversations with this user, naturally reference it like:
"Based on our last conversation about transitioning to product management..."
"I remember you mentioned concerns about your technical background..."
${memoryContext.profile?.target_companies?.[0] ? `"Since you're targeting ${memoryContext.profile.target_companies[0]}..."` : ''}

Do NOT say "According to my memory" or "My records show" - be natural.`;
  }

  systemPrompt += `\n\nQuestion: ${query}\n\nAnswer concisely, professionally, and confidently. Never hallucinate.`;

  return systemPrompt;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

const MATCH_COUNT = 6;

const EMPTY_MEMORY: MemoryContext = {
  profile: null,
  recentSessions: [],
  formattedContext: '',
};

function oodSignal(
  ood: OODDecision | null,
  abstained: boolean,
): CoachSignals['ood'] {
  if (!ood) return null;
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

export async function runCoachPipeline(
  body: unknown,
  deps: CoachPipelineDeps,
): Promise<CoachPipelineResult> {
  const log = deps.log ?? console;
  const gateCounter = deps.gateCounter;

  const parsed = parseCoachRequest(body);
  if (!parsed.ok) {
    return {
      kind: 'invalid-request',
      status: 400,
      body: { error: parsed.error },
    };
  }
  const { query, resumeId, sessionId, userId, messages, skipMemory } =
    parsed.request;

  // Honesty gate. The live answer path needs an OpenAI key (embeddings +
  // generation + judge) and a Supabase connection (pgvector). Without them
  // we return a clear "not configured" state instead of letting the request
  // fail deep inside retrieval and surface as a generic error that looks
  // like an empty/fabricated answer.
  const config = deps.getConfig();
  if (!config.ready) {
    log.warn(
      '[Query] Service not configured; missing env:',
      config.missing.join(', '),
    );
    return {
      kind: 'service-unavailable',
      status: 503,
      body: SERVICE_UNAVAILABLE_PAYLOAD,
    };
  }

  // Honesty gate, part two: the env vars being set does not mean the
  // backend behind them is up. Probe reachability (cached, cheap) before
  // spending an embedding call or pretending to retrieve — a configured
  // deployment pointed at a dead Supabase must say "service unavailable",
  // not improvise an answer-shaped failure.
  const liveness = await deps.checkLiveness();
  if (!liveness.alive) {
    log.error(
      '[Query] Backend liveness check failed:',
      liveness.reason,
      `(${liveness.source})`,
    );
    return {
      kind: 'backend-unavailable',
      status: 503,
      body: BACKEND_UNAVAILABLE_PAYLOAD,
    };
  }

  // MEMORY SCOPING — safe by default. The memory key used to be the bare
  // resumeId ("userId = resumeId" aliasing), so session summaries written in
  // one conversation leaked into every later conversation that shared the
  // resumeId (red-team 2026-05-11 finding #3: ec-01 referenced "the anxiety
  // you mentioned" from cg-03 two prompts earlier — and with no auth, two
  // strangers querying the same resumeId would inherit each other's
  // summaries). The fix used to be opt-in (skipMemory); now the DEFAULT
  // scope is the conversation itself, and cross-session memory requires an
  // EXPLICIT identity claim:
  //   - default:            session:<resumeId>:<sessionId>  (no cross-talk)
  //   - explicit userId:    user:<userId>                   (opted-in recall)
  //   - skipMemory: true:   no memory reads or writes       (eval mode)
  // The namespaced keys also never collide with legacy bare-resumeId rows,
  // so pre-fix summaries (the leak class) are unreadable by design.
  const currentSessionId = sessionId || (deps.newSessionId ?? randomUUID)();
  const memoryKey = userId
    ? `user:${userId}`
    : `session:${resumeId}:${currentSessionId}`;

  let memoryContext: MemoryContext;
  if (skipMemory) {
    memoryContext = EMPTY_MEMORY;
  } else {
    try {
      memoryContext = await deps.getMemoryContext(memoryKey);
    } catch (memoryError: unknown) {
      log.warn(
        '[Memory] Failed to retrieve memory context:',
        memoryError instanceof Error
          ? memoryError.message
          : String(memoryError),
      );
      memoryContext = EMPTY_MEMORY;
    }
  }

  const queryEmbedding = await deps.embedQuery(query);

  const { data, error } = await deps.matchDocuments({
    embedding: queryEmbedding,
    matchCount: MATCH_COUNT,
    resumeId,
  });

  if (error) {
    // A retrieval RPC failure is a SERVICE failure, not an honest empty
    // retrieval. This branch used to return HTTP 200 "No relevant
    // experience found." — masking a dead backend as a normal answer
    // bubble, exactly the failure class the honesty gate exists to
    // prevent (the genuinely-empty case at the no-documents branch below
    // keeps that copy, with sources/signals attached). Return the
    // designed 503 through the client's notice surface instead, and flip
    // the liveness cache so subsequent requests fail fast up front.
    log.error('[Query] RPC error:', error);
    deps.reportBackendDead();
    return {
      kind: 'backend-unavailable',
      status: 503,
      body: BACKEND_UNAVAILABLE_PAYLOAD,
    };
  }

  const firstPage: RetrievedDoc[] = (data ?? []).map((d) => ({
    content: d.content,
    similarity: d.similarity,
  }));

  // PRE-GENERATION OOD GATE: score how *surprising* this query is to the
  // résumé corpus from the top-k cosine similarities the RPC already
  // returned (KEYLESS — no extra embedding/LLM call), and short-circuit
  // clearly-off-résumé queries with an honest "not in your background"
  // BEFORE the model can confabulate. The abstention threshold is
  // CONFORMAL-calibrated to a target abstain budget on the committed
  // red-team run (see lib/quality-gates/ood-gate.ts +
  // docs/OOD_GATE_CALIBRATION.md), not a magic constant. Only runs when
  // there ARE chunks: an empty first page means "no résumé indexed for this
  // id", which the no-documents branch below handles — a different
  // situation from "off-résumé query".
  let ood: OODDecision | null = null;
  if (firstPage.length > 0) {
    ood = decideOOD(firstPage.map((d) => d.similarity));
    if (ood.abstain) {
      // The cheap deterministic tier resolved this turn WITHOUT escalating
      // to the LLM — log that for the per-gate acceptance telemetry.
      gateCounter.record('ood-gate', true);
      const density = estimateDensityFromNeighborSimilarities(
        firstPage.map((d) => d.similarity),
      );
      return {
        kind: 'answered',
        status: 200,
        body: {
          answer: OOD_ABSTAIN_MESSAGE,
          sources: [],
          sessionId: currentSessionId,
          scores: null,
          signals: {
            confidence: density.confidence,
            region: density.region,
            meanSimilarity: density.meanNeighborSimilarity,
            hitl: {
              // We gave an honest deterministic non-answer; no human needed.
              routeToHuman: false,
              triggers: ['off-resume-ood'],
              reason: ood.reason,
            },
            reretrieval: {
              attempted: false,
              fired: false,
              infoGain: null,
              savedCall: false,
              improved: false,
              decision: null,
            },
            satisficing: null,
            grounding: null,
            ood: oodSignal(ood, true),
            cascade: summarizeRequestCascade(
              [buildGateDecision('ood-gate', true)],
              // Live in-instance acceptance tally so far (incl. this turn's
              // OOD skip just recorded above) — the live signal, not the
              // calibrated `.measured` offline replay.
              gateCounter.snapshot(),
            ),
          },
        },
      };
    }
    // OOD gate passed: the cheap tier did NOT skip the expensive LLM step.
    gateCounter.record('ood-gate', false);
  }

  // QUALITY GATES:
  //  - data-density estimates how well the corpus supports this query and
  //    routes to HITL when the retrieval is sparse;
  //  - info-gain decides whether a profile-expanded reformulation is worth a
  //    second retrieval round-trip (and skips it when it would add nothing).
  // The reformulation uses the user's stored profile terms, so it is a
  // deterministic, key-free expansion (no extra LLM call). Skipped for eval
  // runs (skipMemory) so the benchmark measures the base retrieval.
  const refinedQuery = skipMemory
    ? query
    : expandQueryWithProfile(query, memoryContext.profile);

  const pipeline = await runRetrievalPipeline({
    query,
    refinedQuery,
    initialDocs: firstPage,
    queryEmbedding,
    embed: (text) => deps.embedQuery(text),
    retrieve: async (emb) => {
      const { data: reData, error: reError } = await deps.matchDocuments({
        embedding: emb as number[],
        matchCount: MATCH_COUNT,
        resumeId,
      });
      if (reError) {
        log.error('[Query] re-retrieval RPC error:', reError);
        return [];
      }
      return (reData ?? []).map((d) => ({
        content: d.content,
        similarity: d.similarity,
      }));
    },
  });

  const finalDocs = pipeline.docs;

  // Combine the density gate with the existing keyword high-stakes gate.
  const keywordHighStakes = detectHighStakes(query);
  const hitl: HitlRoutingDecision = routeForHitl(
    pipeline.density,
    keywordHighStakes,
  );

  // Per-gate acceptance telemetry for the deterministic gates that ran this
  // turn (the OOD gate was recorded above; satisficing is recorded after the
  // loop). info-gain only "applies" when a re-retrieval was even considered.
  const infoGainSkipped = pipeline.reretrieval.attempted
    ? pipeline.reretrieval.savedCall
    : null;
  if (infoGainSkipped !== null) gateCounter.record('info-gain', infoGainSkipped);
  // data-density resolves the turn without the expensive HITL step when it
  // does NOT route to a human.
  const densitySkippedHitl = !hitl.routeToHuman;
  gateCounter.record('data-density', densitySkippedHitl);

  // Assemble this turn's per-gate decisions (regime + locus + skip flag) for
  // the cascade telemetry payload. OOD passed (did not skip the LLM) to reach
  // here; satisficing is appended once the loop has run.
  const buildTurnGates = (
    satisficingSkipped: boolean | null,
  ): GateDecision[] => {
    const gates: GateDecision[] = [];
    if (ood) gates.push(buildGateDecision('ood-gate', false));
    gates.push(buildGateDecision('info-gain', infoGainSkipped));
    gates.push(buildGateDecision('data-density', densitySkippedHitl));
    gates.push(buildGateDecision('satisficing', satisficingSkipped));
    return gates;
  };

  // No grounding -> do NOT fabricate. Return a clear low-confidence state
  // (with the density/HITL signals) instead of a confident answer.
  if (finalDocs.length === 0) {
    log.log('[Query] No documents found for resumeId:', resumeId);
    return {
      kind: 'answered',
      status: 200,
      body: {
        answer: 'No relevant experience found.',
        sources: [],
        sessionId: currentSessionId,
        scores: null,
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
          // No answer was generated (no grounding), so there are no claims
          // to reconcile — the grounding gate has nothing to check here.
          grounding: null,
          ood: oodSignal(ood, false),
          cascade: summarizeRequestCascade(
            buildTurnGates(null),
            // Live in-instance acceptance tally so far (the live signal, not
            // the calibrated `.measured` offline replay).
            gateCounter.snapshot(),
          ),
        },
      },
    };
  }

  const context = finalDocs.map((d) => d.content).join('\n\n');
  const contexts = finalDocs.map((d) => d.content);

  const systemPrompt = buildSystemPrompt(context, memoryContext, query);

  // SATISFICING STOP: generate, judge against the existing coaching-quality
  // rubric, and stop as soon as the answer clears the quality bar — only
  // revising when it does not. When the answer is good on the first pass
  // (the common case) this is exactly one generation + one judge call; weak
  // answers are revised up to the criteria's safety backstop. If the judge
  // itself fails we fall back to a single grounded generation with no
  // scores (same resilience as before).
  let answer: string;
  let evalResult: CoachingQualityOutput | null = null;
  let satisficing: {
    iterations: number;
    stopReason: StopReason;
    meetsQualityBar: boolean;
  } | null = null;

  const generator: AnswerGenerator = {
    async generate({ iteration, previousAnswer, previousJudge }) {
      const prompt =
        iteration === 1 || !previousAnswer || !previousJudge
          ? systemPrompt
          : buildRevisePrompt(systemPrompt, previousAnswer, previousJudge);
      return deps.generate(prompt);
    },
  };
  const judge: QualityJudge = {
    evaluate: (candidate) =>
      deps.judge({ query, response: candidate, contexts }),
  };

  try {
    // Eval/benchmark runs (skipMemory) measure the RAW first-draft answer:
    // cap satisficing at a single generation + judge so no revision pass
    // shifts the documented benchmark baseline. Re-retrieval is already
    // skipped above for skipMemory for the same reason. Real user traffic
    // runs the full satisficing loop.
    const loop = await runSatisficingLoop({
      generator,
      judge,
      criteria: skipMemory
        ? { ...DEFAULT_SATISFICING_CRITERIA, maxIterations: 1 }
        : DEFAULT_SATISFICING_CRITERIA,
    });
    answer = loop.answer;
    evalResult = loop.finalJudge;
    satisficing = {
      iterations: loop.iterations,
      stopReason: loop.stopReason,
      meetsQualityBar: loop.meetsQualityBar,
    };
  } catch (loopError: unknown) {
    log.warn(
      '[Query] Satisficing loop failed; falling back to single generation:',
      loopError instanceof Error ? loopError.message : String(loopError),
    );
    answer = await deps.generate(systemPrompt);
  }

  // Store eval (non-blocking, best-effort). Only runs when a judge score is
  // available; a storage failure must never break a successful answer.
  if (evalResult) {
    try {
      await deps.storeEval({
        response_id: `${currentSessionId}-query`,
        query,
        response: answer,
        contexts,
        scores: evalResult.scores,
        reasoning: evalResult.reasoning,
        overall_score: evalResult.overall,
      });
    } catch (dbError: unknown) {
      log.warn(
        '[Eval] Failed to store eval:',
        dbError instanceof Error ? dbError.message : String(dbError),
      );
      // Don't fail if DB write fails
    }
  }

  // Fire-and-forget session summarization (zero latency impact). Skipped
  // when skipMemory is true so eval runs do not write contaminating
  // session summaries that later prompts would inherit.
  if (!skipMemory) {
    if (messages && messages.length > 0) {
      // Include current query and response in messages for summarization
      const messagesForSummary = [
        ...messages,
        { role: 'user', content: query },
        { role: 'assistant', content: answer },
      ];
      deps.summarizeSession(memoryKey, currentSessionId, messagesForSummary);
    } else {
      // If no message history provided, summarize just this exchange
      deps.summarizeSession(memoryKey, currentSessionId, [
        { role: 'user', content: query },
        { role: 'assistant', content: answer },
      ]);
    }
  }

  // POST-GENERATION GROUNDING GATE: independently reconcile the factual
  // claims the answer makes about the user against the retrieved résumé
  // evidence (Pacioli's claim-vs-evidence engine over HTTP in production).
  // Complements the pre-generation density/HITL gate and targets the
  // documented mr-02 false-confirmation blind spot (the Coach's own judge
  // scoring a fabrication 85/100). An unconfigured or unreachable gate
  // degrades to a labelled non-blocking result — it never blocks the answer
  // and never fabricates a verdict.
  let grounding: GroundingResult | null = null;
  try {
    grounding = await deps.ground({
      query,
      answer,
      contexts,
      sessionKey: currentSessionId,
    });
  } catch (groundingError: unknown) {
    // The gate is built never to throw; this is belt-and-suspenders so a
    // wiring bug can never break the answer path.
    log.warn(
      '[Grounding] gate failed:',
      groundingError instanceof Error
        ? groundingError.message
        : String(groundingError),
    );
    grounding = null;
  }

  // An answer that never cleared the quality bar — or whose claims failed
  // the grounding check — is itself a reason to escalate to a human,
  // alongside the density / keyword HITL triggers.
  const belowQualityBar = satisficing ? !satisficing.meetsQualityBar : false;
  const groundingFlagged = grounding?.status === 'flagged';
  const triggers: string[] = [...hitl.triggers];
  if (belowQualityBar) triggers.push('below-quality-bar');
  if (groundingFlagged) triggers.push('grounding-unsupported');

  // Satisficing acceptance telemetry: the loop "skipped the expensive step"
  // (a further generate+judge pass) when it stopped early on the satisficed /
  // diminishing-returns criterion rather than burning the iteration budget.
  // For eval runs (skipMemory) the loop is capped at 1 iteration, so there
  // is no genuine skip decision to log (null).
  const satisficingSkipped =
    satisficing && !skipMemory
      ? satisficing.stopReason === 'satisficed' ||
        satisficing.stopReason === 'diminishing-returns'
      : null;
  if (satisficingSkipped !== null)
    gateCounter.record('satisficing', satisficingSkipped);

  return {
    kind: 'answered',
    status: 200,
    body: {
      answer,
      sources: finalDocs.map((d) => ({
        content: d.content,
        similarity: d.similarity,
      })),
      sessionId: currentSessionId,
      scores: evalResult
        ? {
            overall: evalResult.overall,
            actionability: evalResult.scores.actionability,
            personalization: evalResult.scores.personalization,
            honesty: evalResult.scores.honesty,
            grounding: evalResult.scores.grounding,
          }
        : null,
      signals: {
        confidence: pipeline.density.confidence,
        region: pipeline.density.region,
        meanSimilarity: pipeline.density.meanNeighborSimilarity,
        hitl: {
          routeToHuman:
            hitl.routeToHuman || belowQualityBar || Boolean(groundingFlagged),
          triggers,
          reason: hitl.reason,
        },
        reretrieval: pipeline.reretrieval,
        satisficing,
        grounding,
        ood: oodSignal(ood, false),
        cascade: summarizeRequestCascade(
          buildTurnGates(satisficingSkipped),
          // Live in-instance acceptance tally so far across all gates
          // recorded this turn (the live signal, not the calibrated
          // `.measured` replay).
          gateCounter.snapshot(),
        ),
      },
    },
  };
}
