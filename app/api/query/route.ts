import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabase } from "@/lib/supabase";
import { getChatClient, getEmbeddings } from "@/lib/rag";
import {
  getMemoryContext,
  summarizeSessionAsync,
  type MemoryContext,
} from "@/lib/memory";
import {
  evaluateCoachingQuality,
  type CoachingQualityOutput,
} from "@/lib/evals/coaching-quality";
import { detectHighStakes } from "@/lib/hitl-detection";
import {
  getServiceConfig,
  SERVICE_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";
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
} from "@/lib/quality-gates";
import { runGroundingGate, type GroundingResult } from "@/lib/grounding";

/**
 * Per-instance running acceptance-rate counter for the four gates on the answer
 * path (OOD, data-density/HITL, info-gain, satisficing). It logs how often each
 * gate's cheap/deterministic tier "skipped the expensive step" vs escalated.
 * In-memory (resets on cold start, not shared across serverless instances) — a
 * lightweight live signal, NOT the calibrated metric (that is the committed
 * offline replay surfaced via summarizeRequestCascade().measured).
 */
const gateCounter = new GateCounter();

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
    weak.length ? ` and was weak on: ${weak.join(", ")}` : ""
  }. Judge feedback: ${previousJudge.reasoning}

PREVIOUS DRAFT:
${previousAnswer}

Revise the answer to address that feedback while staying strictly grounded in the candidate context above. Do NOT invent details to raise the score — if the context genuinely does not support a stronger answer, acknowledge the limitation honestly instead of fabricating.`;
}

const MATCH_COUNT = 6;

export async function POST(req: NextRequest) {
  try {
    const { query, resumeId, sessionId, messages, skipMemory } =
      await req.json();

    if (!resumeId || typeof resumeId !== "string") {
      return NextResponse.json({ error: "resumeId required" }, { status: 400 });
    }

    // Reject empty input. Red-team ec-01 (2026-05-11) showed an empty
    // query was embedded, retrieved against, and used to ground a
    // fabricated response — the route had no input boundary validation.
    if (typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json({ error: "query required" }, { status: 400 });
    }

    // Honesty gate. The live answer path needs an OpenAI key (embeddings +
    // generation + judge) and a Supabase connection (pgvector). Without them
    // we return a clear "not configured" state instead of letting the request
    // fail deep inside retrieval and surface as a generic error that looks
    // like an empty/fabricated answer. The pure quality-gate modules remain
    // unit-testable offline regardless of this.
    const config = getServiceConfig();
    if (!config.ready) {
      console.warn(
        "[Query] Service not configured; missing env:",
        config.missing.join(", "),
      );
      return NextResponse.json(SERVICE_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    const supabase = getSupabase();
    const embeddings = getEmbeddings();
    const llm = getChatClient();

    // userId is currently aliased to resumeId, so the memory key is the
    // resume rather than the user. For eval runs this means earlier prompts
    // in the same script contaminate later prompts via the async session
    // summarizer (red-team 2026-05-11 surfaced this: ec-01 referenced "the
    // anxiety you mentioned" from cg-03 two prompts earlier). Callers can
    // pass skipMemory: true to opt out of both loading and writing memory.
    const userId = resumeId;
    const currentSessionId = sessionId || randomUUID();

    let memoryContext: MemoryContext;
    if (skipMemory) {
      memoryContext = {
        profile: null,
        recentSessions: [],
        formattedContext: "",
      };
    } else {
      try {
        memoryContext = await getMemoryContext(userId);
      } catch (memoryError: unknown) {
        console.warn(
          "[Memory] Failed to retrieve memory context:",
          memoryError instanceof Error
            ? memoryError.message
            : String(memoryError),
        );
        memoryContext = {
          profile: null,
          recentSessions: [],
          formattedContext: "",
        };
      }
    }

    const queryEmbedding = await embeddings.embedQuery(query);

    const { data, error } = await supabase.rpc("match_documents_v2", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      p_resume_id: resumeId,
      p_user_id: null,
    });

    if (error) {
      console.error("[Query] RPC error:", error);
      return NextResponse.json({ answer: "No relevant experience found." });
    }

    const firstPage: RetrievedDoc[] = (data ?? []).map((d) => ({
      content: d.content,
      similarity: d.similarity,
    }));

    // PRE-GENERATION OOD GATE (wired live): score how *surprising* this query is
    // to the résumé corpus from the top-k cosine similarities the RPC already
    // returned (KEYLESS — no extra embedding/LLM call), and short-circuit
    // clearly-off-résumé queries with an honest "not in your background" BEFORE
    // the model can confabulate. The abstention threshold is CONFORMAL-calibrated
    // to a target abstain budget on the committed red-team run (see
    // lib/quality-gates/ood-gate.ts + docs/OOD_GATE_CALIBRATION.md), not a magic
    // constant. Only runs when there ARE chunks: an empty first page means "no
    // résumé indexed for this id", which the no-documents branch below handles —
    // a different situation from "off-résumé query".
    let ood: OODDecision | null = null;
    if (firstPage.length > 0) {
      ood = decideOOD(firstPage.map((d) => d.similarity));
      if (ood.abstain) {
        // The cheap deterministic tier resolved this turn WITHOUT escalating to
        // the LLM — log that for the per-gate acceptance telemetry.
        gateCounter.record("ood-gate", true);
        const density = estimateDensityFromNeighborSimilarities(
          firstPage.map((d) => d.similarity),
        );
        return NextResponse.json({
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
              triggers: ["off-resume-ood"],
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
            ood: {
              abstained: true,
              score: ood.score,
              threshold: ood.threshold,
              targetAbstainRate: ood.targetAbstainRate,
              coverage: ood.coverage,
              centroidProximity: ood.centroidProximity,
              margin: ood.margin,
            },
            cascade: summarizeRequestCascade([
              buildGateDecision("ood-gate", true),
            ]),
          },
        });
      }
      // OOD gate passed: the cheap tier did NOT skip the expensive LLM step.
      gateCounter.record("ood-gate", false);
    }

    // QUALITY GATES (wired live):
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
      embed: (text) => embeddings.embedQuery(text),
      retrieve: async (emb) => {
        const { data: reData, error: reError } = await supabase.rpc(
          "match_documents_v2",
          {
            query_embedding: emb as number[],
            match_count: MATCH_COUNT,
            p_resume_id: resumeId,
            p_user_id: null,
          },
        );
        if (reError) {
          console.error("[Query] re-retrieval RPC error:", reError);
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
    const hitl = routeForHitl(pipeline.density, keywordHighStakes);

    // Per-gate acceptance telemetry for the deterministic gates that ran this
    // turn (the OOD gate was recorded above; satisficing is recorded after the
    // loop). info-gain only "applies" when a re-retrieval was even considered.
    const infoGainSkipped = pipeline.reretrieval.attempted
      ? pipeline.reretrieval.savedCall
      : null;
    if (infoGainSkipped !== null) gateCounter.record("info-gain", infoGainSkipped);
    // data-density resolves the turn without the expensive HITL step when it
    // does NOT route to a human.
    const densitySkippedHitl = !hitl.routeToHuman;
    gateCounter.record("data-density", densitySkippedHitl);

    // Assemble this turn's per-gate decisions (regime + locus + skip flag) for
    // the cascade telemetry payload. OOD passed (did not skip the LLM) to reach
    // here; satisficing is appended once the loop has run.
    const buildTurnGates = (
      satisficingSkipped: boolean | null,
    ): GateDecision[] => {
      const gates: GateDecision[] = [];
      if (ood) gates.push(buildGateDecision("ood-gate", false));
      gates.push(buildGateDecision("info-gain", infoGainSkipped));
      gates.push(buildGateDecision("data-density", densitySkippedHitl));
      gates.push(buildGateDecision("satisficing", satisficingSkipped));
      return gates;
    };

    // No grounding -> do NOT fabricate. Return a clear low-confidence state
    // (with the density/HITL signals) instead of a confident answer.
    if (finalDocs.length === 0) {
      console.log("[Query] No documents found for resumeId:", resumeId);
      return NextResponse.json({
        answer: "No relevant experience found.",
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
          // No answer was generated (no grounding), so there are no claims to
          // reconcile — the grounding gate has nothing to check here.
          grounding: null,
          ood: ood
            ? {
                abstained: false,
                score: ood.score,
                threshold: ood.threshold,
                targetAbstainRate: ood.targetAbstainRate,
                coverage: ood.coverage,
                centroidProximity: ood.centroidProximity,
                margin: ood.margin,
              }
            : null,
          cascade: summarizeRequestCascade(buildTurnGates(null)),
        },
      });
    }

    const context = finalDocs.map((d) => d.content).join("\n\n");
    const contexts = finalDocs.map((d) => d.content);

    // Build system prompt with memory context
    let systemPrompt = `You are an expert AI career coach helping candidates land their dream roles.

Use ONLY the following context from the candidate's background:

${context}`;

    // Inject memory context if available
    if (memoryContext.formattedContext) {
      systemPrompt += `\n\n## What You Remember About This User\n${memoryContext.formattedContext}`;
    }

    // Add communication style guidance
    if (memoryContext.profile?.communication_style === "direct") {
      systemPrompt += "\n\nBe direct and concise in your feedback.";
    } else if (memoryContext.profile?.communication_style === "encouraging") {
      systemPrompt +=
        "\n\nBe supportive and encouraging while giving feedback.";
    } else {
      systemPrompt += "\n\nBalance honesty with encouragement.";
    }

    // Add natural memory reference instructions
    if (memoryContext.profile || memoryContext.recentSessions.length > 0) {
      systemPrompt += `\n\nIf you have memory of previous conversations with this user, naturally reference it like:
"Based on our last conversation about transitioning to product management..."
"I remember you mentioned concerns about your technical background..."
${memoryContext.profile?.target_companies?.[0] ? `"Since you're targeting ${memoryContext.profile.target_companies[0]}..."` : ""}

Do NOT say "According to my memory" or "My records show" - be natural.`;
    }

    systemPrompt += `\n\nQuestion: ${query}\n\nAnswer concisely, professionally, and confidently. Never hallucinate.`;

    // SATISFICING STOP (wired live): generate, judge against the existing
    // coaching-quality rubric, and stop as soon as the answer clears the
    // quality bar — only revising when it does not. When the answer is good
    // on the first pass (the common case) this is exactly one generation + one
    // judge call, i.e. the same cost as before; weak answers are revised up to
    // the criteria's safety backstop. If the judge itself fails we fall back to
    // a single grounded generation with no scores (same resilience as before).
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
        const response = await llm.invoke(prompt);
        return response.content.toString();
      },
    };
    const judge: QualityJudge = {
      evaluate: (candidate) =>
        evaluateCoachingQuality({ query, response: candidate, contexts }),
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
      console.warn(
        "[Query] Satisficing loop failed; falling back to single generation:",
        loopError instanceof Error ? loopError.message : String(loopError),
      );
      const response = await llm.invoke(systemPrompt);
      answer = response.content.toString();
    }

    // Store eval in Supabase (non-blocking). Reuses the outer `supabase`
    // client. Only runs when a judge score is available.
    if (evalResult) {
      try {
        await supabase.from("evals").insert({
          response_id: `${currentSessionId}-query`,
          query,
          response: answer,
          contexts,
          scores: evalResult.scores,
          reasoning: evalResult.reasoning,
          overall_score: evalResult.overall,
        });
      } catch (dbError: unknown) {
        console.warn(
          "[Eval] Failed to store eval:",
          dbError instanceof Error ? dbError.message : String(dbError),
        );
        // Don't fail if DB write fails
      }
    }

    // Fire-and-forget session summarization (zero latency impact). Skipped
    // when skipMemory is true so eval runs do not write contaminating
    // session summaries that later prompts would inherit.
    if (!skipMemory) {
      if (messages && Array.isArray(messages) && messages.length > 0) {
        // Include current query and response in messages for summarization
        const messagesForSummary = [
          ...messages,
          { role: "user", content: query },
          { role: "assistant", content: answer },
        ];
        summarizeSessionAsync(userId, currentSessionId, messagesForSummary);
      } else {
        // If no message history provided, summarize just this exchange
        summarizeSessionAsync(userId, currentSessionId, [
          { role: "user", content: query },
          { role: "assistant", content: answer },
        ]);
      }
    }

    // POST-GENERATION GROUNDING GATE (wired live): independently reconcile the
    // factual claims the answer makes about the user against the retrieved
    // résumé evidence via Pacioli's claim-vs-evidence engine over HTTP. This
    // complements the pre-generation density/HITL gate and targets the
    // documented mr-02 false-confirmation blind spot (the Coach's own judge
    // scoring a fabrication 85/100). Config-gated by PACIOLI_RECONCILE_URL: an
    // unset URL or unreachable peer degrades to a 'skipped'/'unavailable'
    // result — it never blocks the answer and never fabricates a verdict.
    let grounding: GroundingResult | null = null;
    try {
      grounding = await runGroundingGate({
        query,
        answer,
        contexts,
        sessionKey: currentSessionId,
      });
    } catch (groundingError: unknown) {
      // The gate is built never to throw; this is belt-and-suspenders so a
      // wiring bug can never break the answer path.
      console.warn(
        "[Grounding] gate failed:",
        groundingError instanceof Error
          ? groundingError.message
          : String(groundingError),
      );
      grounding = null;
    }

    // An answer that never cleared the quality bar — or whose claims failed the
    // grounding check — is itself a reason to escalate to a human, alongside
    // the density / keyword HITL triggers.
    const belowQualityBar = satisficing ? !satisficing.meetsQualityBar : false;
    const groundingFlagged = grounding?.status === "flagged";
    const triggers: string[] = [...hitl.triggers];
    if (belowQualityBar) triggers.push("below-quality-bar");
    if (groundingFlagged) triggers.push("grounding-unsupported");

    // Satisficing acceptance telemetry: the loop "skipped the expensive step"
    // (a further generate+judge pass) when it stopped early on the satisficed /
    // diminishing-returns criterion rather than burning the iteration budget.
    // For eval runs (skipMemory) the loop is capped at 1 iteration, so there is
    // no genuine skip decision to log (null).
    const satisficingSkipped =
      satisficing && !skipMemory
        ? satisficing.stopReason === "satisficed" ||
          satisficing.stopReason === "diminishing-returns"
        : null;
    if (satisficingSkipped !== null)
      gateCounter.record("satisficing", satisficingSkipped);

    return NextResponse.json({
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
        ood: ood
          ? {
              abstained: false,
              score: ood.score,
              threshold: ood.threshold,
              targetAbstainRate: ood.targetAbstainRate,
              coverage: ood.coverage,
              centroidProximity: ood.centroidProximity,
              margin: ood.margin,
            }
          : null,
        cascade: summarizeRequestCascade(buildTurnGates(satisficingSkipped)),
      },
    });
  } catch (error: unknown) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Security hardening 2026-05-12.
    console.error("Query error:", error);
    return NextResponse.json(
      {
        answer: "Sorry, I encountered an error processing your query.",
      },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";
