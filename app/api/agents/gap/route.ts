// app/api/agents/gap/route.ts

import { NextRequest } from "next/server";

import {
  getServiceConfig,
  GENERATION_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";

import { findGaps } from "@/lib/agents/gap-finder/node";

import { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";

export async function POST(req: NextRequest) {
  try {
    const { resumeAnalysis, jobDescription } = await req.json();

    if (!resumeAnalysis || !jobDescription)
      return Response.json({ error: "Missing data" }, { status: 400 });

    // Honesty gate: generation needs an OpenAI key (and nothing else on this
    // route). Without it, return the designed 503 instead of failing inside
    // the LLM call and surfacing as a generic 500.
    const config = getServiceConfig();
    if (!config.openai) {
      console.warn(
        "[Gap] Generation not configured; missing env:",
        config.missing.join(", "),
      );
      return Response.json(GENERATION_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    const gaps = await findGaps(
      resumeAnalysis as ResumeAnalysis,
      jobDescription,
    );

    return Response.json({ success: true, gaps });
  } catch (error: unknown) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Security hardening 2026-05-12.
    console.error("Gap analysis agent error:", error);
    return Response.json(
      { error: "Internal error during gap analysis." },
      { status: 500 },
    );
  }
}
