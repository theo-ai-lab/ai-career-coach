import { NextRequest } from "next/server";
import {
  getServiceConfig,
  GENERATION_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";
import { generateInterviewPrep } from "@/lib/agents/interview-prep/node";
import { detectHighStakesInData } from "@/lib/hitl-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, gapAnalysis, jobDescription, company } =
      await req.json();

    // Honesty gate: generation needs an OpenAI key (and nothing else on this
    // route). Without it, return the designed 503 instead of failing inside
    // the LLM call and surfacing as a generic 500.
    const config = getServiceConfig();
    if (!config.openai) {
      console.warn(
        "[InterviewPrep] Generation not configured; missing env:",
        config.missing.join(", "),
      );
      return Response.json(GENERATION_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    const prep = await generateInterviewPrep(
      resumeAnalysis,
      gapAnalysis,
      jobDescription,
      company || "OpenAI",
    );

    // Detect high-stakes content (e.g., negotiation tactics, salary discussions)
    const highStakes = detectHighStakesInData(prep);

    return Response.json({ success: true, prep, highStakes });
  } catch (error: unknown) {
    console.error("Interview prep agent error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
