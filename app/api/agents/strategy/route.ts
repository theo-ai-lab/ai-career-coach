import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit-server";
import {
  getServiceConfig,
  GENERATION_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";
import { generateStrategy } from "@/lib/agents/strategy-advisor/node";
import { detectHighStakesInData } from "@/lib/hitl-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Per-IP rate gate FIRST — before body parsing, before the honesty
  // gates, before any OpenAI spend (lib/rate-limit.ts).
  const limited = enforceRateLimit(req, "agents");
  if (limited) return limited;

  try {
    const { resumeAnalysis, gapAnalysis, targetCompany } = await req.json();

    // Honesty gate: generation needs an OpenAI key (and nothing else on this
    // route). Without it, return the designed 503 instead of failing inside
    // the LLM call and surfacing as a generic 500.
    const config = getServiceConfig();
    if (!config.openai) {
      console.warn(
        "[Strategy] Generation not configured; missing env:",
        config.missing.join(", "),
      );
      return Response.json(GENERATION_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    const plan = await generateStrategy(
      resumeAnalysis,
      gapAnalysis,
      targetCompany || "OpenAI",
    );

    // Detect high-stakes content (e.g., quitting current job, major career changes)
    const highStakes = detectHighStakesInData(plan);

    return Response.json({ success: true, plan, highStakes });
  } catch (error: unknown) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Security hardening 2026-05-12.
    console.error("Strategy advisor agent error:", error);
    return Response.json(
      { error: "Failed to generate strategy." },
      { status: 500 },
    );
  }
}
