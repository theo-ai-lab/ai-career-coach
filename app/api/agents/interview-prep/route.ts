import { NextRequest } from "next/server";
import { generateInterviewPrep } from "@/lib/agents/interview-prep/node";
import { detectHighStakesInData } from "@/lib/hitl-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, gapAnalysis, jobDescription, company } =
      await req.json();

    const prep = await generateInterviewPrep(
      resumeAnalysis,
      gapAnalysis,
      jobDescription,
      company || "OpenAI"
    );

    // Detect high-stakes content (e.g., negotiation tactics, salary discussions)
    const highStakes = detectHighStakesInData(prep);

    return Response.json({ success: true, prep, highStakes });
  } catch (error: any) {
    console.error("Interview prep agent error:", error);
    return Response.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}


