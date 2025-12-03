import { NextRequest } from "next/server";
import { generateInterviewPrep } from "@/lib/agents/interview-prep/node";
import type { JobMatch } from "@/lib/agents/job-matcher/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, gapAnalysis, jobDescription, company, jobMatch } =
      await req.json();

    const prep = await generateInterviewPrep(
      resumeAnalysis,
      gapAnalysis,
      jobDescription,
      company || "OpenAI",
      jobMatch as JobMatch | undefined
    );

    return Response.json({ success: true, prep });
  } catch (error: any) {
    console.error("Interview prep agent error:", error);
    return Response.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}


