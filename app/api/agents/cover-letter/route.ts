import { NextRequest } from "next/server";
import { writeCoverLetter } from "@/lib/agents/cover-letter/node";
import { detectHighStakesInData } from "@/lib/hitl-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, gapAnalysis, company } = await req.json();

    const letter = await writeCoverLetter(
      resumeAnalysis,
      gapAnalysis,
      company || "OpenAI",
    );

    // Detect high-stakes content (e.g., salary expectations)
    const highStakes = detectHighStakesInData(letter);

    return Response.json({ success: true, letter, highStakes });
  } catch (error: any) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Pre-ship audit 2026-05-12, L2-038.
    console.error("Cover letter agent error:", error);
    return Response.json(
      { error: "Failed to generate cover letter." },
      { status: 500 },
    );
  }
}
