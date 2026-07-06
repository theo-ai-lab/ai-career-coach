import { NextRequest, NextResponse } from "next/server";
import { runDemoQuery } from "@/lib/demo/run-demo-query";

/**
 * KEYLESS DEMO answer path (/demo). Always available — it needs no OpenAI
 * key, no Supabase connection, no env var at all, so a visitor can experience
 * the quality gates (conformal OOD abstention, density/HITL routing) on a
 * deployment whose live backend is not configured.
 *
 * Everything model-shaped is committed, labeled data: a fictional demo
 * résumé, deterministic demo embeddings, a conformal threshold re-derived on
 * that space, and canned/extractive answers that label themselves. The gate
 * DECISIONS are made by the real production modules at request time (see
 * lib/demo/run-demo-query.ts for the exact real-vs-canned inventory). Zero
 * impact on the live path: nothing under /api/query changes because this
 * route exists.
 */
export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    // Same input boundary as the live route (red-team ec-01): reject empty
    // queries before any gate runs.
    if (typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json({ error: "query required" }, { status: 400 });
    }

    const result = await runDemoQuery(query);
    return NextResponse.json(result);
  } catch (error: unknown) {
    // Nothing secret can leak here (the demo path holds no credentials), but
    // keep the same client-facing error discipline as the live route.
    console.error("Demo query error:", error);
    return NextResponse.json(
      {
        answer: "Sorry, I encountered an error processing your demo query.",
      },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";
