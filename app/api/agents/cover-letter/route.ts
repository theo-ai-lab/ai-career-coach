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
      company || "OpenAI"
    );

    // Detect high-stakes content (e.g., salary expectations)
    const highStakes = detectHighStakesInData(letter);

    return Response.json({ success: true, letter, highStakes });
  } catch (error: any) {
    console.error("Cover letter agent error:", error);
    return Response.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}


