import { NextRequest } from "next/server";
import {
  evaluateCoachingQuality,
  CoachingQualityInput,
} from "@/lib/evals/coaching-quality";
import { getSupabase } from "@/lib/supabase";
import {
  getServiceConfig,
  GENERATION_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, response, contexts, responseId } = body;

    // Validate required fields
    if (!query || !response || !Array.isArray(contexts)) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: query, response, contexts",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Honesty gate: the judge is an OpenAI call. Without the key, return
    // the designed 503 instead of a generic 500 from inside the LLM call.
    // Storage is best-effort and separately guarded below.
    const config = getServiceConfig();
    if (!config.openai) {
      console.warn(
        "[Evals] Generation not configured; missing env:",
        config.missing.join(", "),
      );
      return new Response(JSON.stringify(GENERATION_UNAVAILABLE_PAYLOAD), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Run evaluation
    const evalResult = await evaluateCoachingQuality({
      query,
      response,
      contexts,
    } as CoachingQualityInput);

    // Store in Supabase (best-effort). Guarded on configuration so an
    // optional write can never turn a successful judge result into a 500
    // (getSupabase() throws when its env vars are unset).
    if (config.supabase) {
      const supabase = getSupabase();
      const { error: dbError } = await supabase.from("evals").insert({
        response_id: responseId || null,
        query,
        response,
        contexts,
        scores: evalResult.scores,
        reasoning: evalResult.reasoning,
        overall_score: evalResult.overall,
      });

      if (dbError) {
        console.error("Failed to store eval in Supabase:", dbError);
        // Don't fail the request if DB write fails, just log it
      }
    } else {
      console.warn("[Evals] Supabase not configured; eval result not stored.");
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...evalResult,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error: unknown) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Security hardening 2026-05-12.
    console.error("Coaching quality eval error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to evaluate coaching quality." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
