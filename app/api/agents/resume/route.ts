// app/api/agents/resume/route.ts

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit-server";

import {
  getServiceConfig,
  SERVICE_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";
import { BACKEND_UNAVAILABLE_PAYLOAD } from "@/lib/backend-liveness";
import { getBackendLiveness } from "@/lib/backend-liveness-server";

import { analyzeResume } from "@/lib/agents/resume-analyzer/node";

export async function POST(req: NextRequest) {
  // Per-IP rate gate FIRST — before body parsing, before the honesty
  // gates, before any OpenAI spend (lib/rate-limit.ts).
  const limited = enforceRateLimit(req, "agents");
  if (limited) return limited;

  try {
    const { userId, resumeText } = await req.json();

    if (!userId || !resumeText)
      return Response.json({ error: "Missing data" }, { status: 400 });

    // Honesty gate: this route needs an OpenAI key AND the Supabase backend
    // (pgvector retrieval). Missing keys -> designed 503; keys present but
    // backend dead (shared cached probe) -> designed 503 — both BEFORE any
    // OpenAI spend, never a generic 500 from deep inside retrieval.
    const config = getServiceConfig();
    if (!config.ready) {
      console.warn(
        "[Resume] Service not configured; missing env:",
        config.missing.join(", "),
      );
      return Response.json(SERVICE_UNAVAILABLE_PAYLOAD, { status: 503 });
    }
    const liveness = await getBackendLiveness().check();
    if (!liveness.alive) {
      console.error(
        "[Resume] Backend liveness check failed:",
        liveness.reason,
        `(${liveness.source})`,
      );
      return Response.json(BACKEND_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

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
