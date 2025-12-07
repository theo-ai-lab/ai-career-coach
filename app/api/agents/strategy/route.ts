import { NextRequest } from "next/server";
import { generateStrategy } from "@/lib/agents/strategy-advisor/node";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, gapAnalysis, targetCompany } = await req.json();

    const plan = await generateStrategy(
      resumeAnalysis,
      gapAnalysis,
      targetCompany || "OpenAI"
    );

    return Response.json({ success: true, plan });
  } catch (error: any) {
    console.error("Strategy advisor agent error:", error);
    return Response.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}


