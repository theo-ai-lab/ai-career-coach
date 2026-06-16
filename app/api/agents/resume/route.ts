// app/api/agents/resume/route.ts

import { NextRequest } from "next/server";

import { analyzeResume } from "@/lib/agents/resume-analyzer/node";

export async function POST(req: NextRequest) {
  try {
    const { userId, resumeText } = await req.json();

    if (!userId || !resumeText)
      return Response.json({ error: "Missing data" }, { status: 400 });

    const analysis = await analyzeResume(userId, resumeText);

    return Response.json({ success: true, analysis });
  } catch (error: unknown) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Security hardening 2026-05-12.
    console.error("Resume analysis agent error:", error);
    return Response.json(
      { error: "Internal error during resume analysis." },
      { status: 500 },
    );
  }
}
