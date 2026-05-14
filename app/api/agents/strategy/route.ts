import { NextRequest } from "next/server";
import { generateStrategy } from "@/lib/agents/strategy-advisor/node";
import { detectHighStakesInData } from "@/lib/hitl-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, gapAnalysis, targetCompany } = await req.json();

    const plan = await generateStrategy(
      resumeAnalysis,
      gapAnalysis,
      targetCompany || "OpenAI",
    );

    // Detect high-stakes content (e.g., quitting current job, major career changes)
    const highStakes = detectHighStakesInData(plan);

    return Response.json({ success: true, plan, highStakes });
  } catch (error: any) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Pre-ship audit 2026-05-12, L2-038.
    console.error("Strategy advisor agent error:", error);
    return Response.json(
      { error: "Failed to generate strategy." },
      { status: 500 },
    );
  }
}
