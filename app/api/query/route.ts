import { NextRequest, NextResponse } from "next/server";

import { getSupabase } from "@/lib/supabase";
import { getChatClient, getEmbeddings } from "@/lib/rag";
import { getMemoryContext, summarizeSessionAsync } from "@/lib/memory";
import { evaluateCoachingQuality } from "@/lib/evals/coaching-quality";
import { getServiceConfig } from "@/lib/service-config";
import { getBackendLiveness } from "@/lib/backend-liveness-server";
import { runGroundingGate } from "@/lib/grounding";
import { GateCounter } from "@/lib/quality-gates";
import {
  runCoachPipeline,
  type CoachPipelineDeps,
} from "@/lib/coach-pipeline";

/**
 * POST /api/query — the live grounded answer path. Thin adapter over
 * lib/coach-pipeline.ts, which owns every decision (honesty gates, OOD
 * abstention, density/HITL, satisficing loop, grounding) and is unit-tested
 * offline with all of these dependencies mocked — including the regression
 * lock that a retrieval RPC failure returns the designed 503, never an
 * HTTP 200 "No relevant experience found.".
 *
 * This file only binds the pipeline to the real world: Supabase, OpenAI,
 * the process-wide liveness cache, and the per-instance gate counter.
 */

/**
 * Per-instance running acceptance-rate counter for the four gates on the
 * answer path (OOD, data-density/HITL, info-gain, satisficing). In-memory
 * (resets on cold start, not shared across serverless instances) — a
 * lightweight live signal surfaced under signals.cascade.live, deliberately
 * distinct from signals.cascade.measured (the calibrated offline replay).
 */
const gateCounter = new GateCounter();

/**
 * Backend-liveness gate (honesty gate, part two): the process-wide cached
 * probe shared by every Supabase-touching route — see
 * lib/backend-liveness-server.ts for the full rationale.
 */
const backendLiveness = getBackendLiveness();

/** Bind the pipeline's injected dependencies to the real services. */
function buildDeps(): CoachPipelineDeps {
  return {
    getConfig: () => getServiceConfig(),
    checkLiveness: () => backendLiveness.check(),
    reportBackendDead: () => backendLiveness.reportDead(),
    embedQuery: (text) => getEmbeddings().embedQuery(text),
    matchDocuments: async ({ embedding, matchCount, resumeId }) => {
      const { data, error } = await getSupabase().rpc("match_documents_v2", {
        query_embedding: embedding as number[],
        match_count: matchCount,
        p_resume_id: resumeId,
        p_user_id: null,
      });
      return { data, error };
    },
    generate: async (prompt) => {
      const response = await getChatClient().invoke(prompt);
      return response.content.toString();
    },
    judge: (input) => evaluateCoachingQuality(input),
    // The pipeline computes the memory key (conversation-scoped by default;
    // user:<id> only on an explicit userId claim — red-team finding #3).
    getMemoryContext: (memoryKey) => getMemoryContext(memoryKey),
    summarizeSession: (memoryKey, sessionId, messages) =>
      summarizeSessionAsync(memoryKey, sessionId, messages),
    storeEval: async (record) => {
      const { error } = await getSupabase().from("evals").insert(record);
      if (error) throw new Error(error.message);
    },
    ground: (input) => runGroundingGate(input),
    gateCounter,
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Malformed JSON is a client problem: a designed 400, not a generic 500
    // (same discipline as /api/upload's multipart boundary).
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const result = await runCoachPipeline(body, buildDeps());
    return NextResponse.json(result.body, { status: result.status });
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
