import { NextRequest } from "next/server";
import {
  getServiceConfig,
  GENERATION_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";
import { writeCoverLetter } from "@/lib/agents/cover-letter/node";
import { detectHighStakesInData } from "@/lib/hitl-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, gapAnalysis, company } = await req.json();

    // Honesty gate: generation needs an OpenAI key (and nothing else on this
    // route). Without it, return the designed 503 instead of failing inside
    // the LLM call and surfacing as a generic 500.
    const config = getServiceConfig();
    if (!config.openai) {
      console.warn(
        "[CoverLetter] Generation not configured; missing env:",
        config.missing.join(", "),
      );
      return Response.json(GENERATION_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    const letter = await writeCoverLetter(
      resumeAnalysis,
      gapAnalysis,
      company || "OpenAI",
    );

    // Detect high-stakes content (e.g., salary expectations)
    const highStakes = detectHighStakesInData(letter);

    return Response.json({ success: true, letter, highStakes });
  } catch (error: unknown) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Security hardening 2026-05-12.
    console.error("Cover letter agent error:", error);
    return Response.json(
      { error: "Failed to generate cover letter." },
      { status: 500 },
    );
  }
}
