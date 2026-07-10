import { NextRequest, NextResponse } from "next/server";

import { getSupabase } from "@/lib/supabase";
import { getEmbeddings } from "@/lib/rag";
import {
  getServiceConfig,
  SERVICE_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";
import { BACKEND_UNAVAILABLE_PAYLOAD } from "@/lib/backend-liveness";
import { getBackendLiveness } from "@/lib/backend-liveness-server";
import {
  validateUploadForm,
  extractPdfText,
  splitResumeText,
  runUploadIngestion,
} from "@/lib/upload-pipeline";

/**
 * POST /api/upload — PDF resume ingestion (parse -> chunk -> embed ->
 * documents rows). Thin adapter over lib/upload-pipeline.ts, which owns the
 * decisions and is unit-tested offline.
 *
 * Failure semantics (the honesty gate, same discipline as /api/query):
 *   - malformed multipart / wrong field types / unreadable or empty PDF
 *     -> 400 with a plain reason (client problems, zero OpenAI spend);
 *   - keys missing -> 503 SERVICE_UNAVAILABLE_PAYLOAD;
 *   - keys present but backend dead (cached probe, or the insert itself
 *     failing mid-request) -> 503 BACKEND_UNAVAILABLE_PAYLOAD + reportDead,
 *     BEFORE any embedding call whenever the probe catches it first;
 *   - anything genuinely unexpected -> generic 500 (never the raw error).
 */
export async function POST(req: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart/form-data with file and userId fields." },
        { status: 400 },
      );
    }

    const fields = validateUploadForm(
      formData.get("file"),
      formData.get("userId"),
    );
    if (!fields.ok) {
      return NextResponse.json({ error: fields.error }, { status: 400 });
    }

    // Honesty gate: ingestion needs an OpenAI key (embeddings) and a
    // Supabase service-role connection (documents insert). Without them,
    // say so up front instead of failing mid-pipeline as a generic error.
    const config = getServiceConfig();
    if (!config.ready) {
      console.warn(
        "[Upload] Service not configured; missing env:",
        config.missing.join(", "),
      );
      return NextResponse.json(SERVICE_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    // Honesty gate, part two: keys being set does not mean the backend
    // behind them is up. The shared cached probe runs BEFORE the PDF is
    // parsed or embedded, so a dead backend costs nothing and returns the
    // designed 503 instead of "Internal error during upload."
    const liveness = await getBackendLiveness().check();
    if (!liveness.alive) {
      console.error(
        "[Upload] Backend liveness check failed:",
        liveness.reason,
        `(${liveness.source})`,
      );
      return NextResponse.json(BACKEND_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    const buffer = new Uint8Array(await fields.file.arrayBuffer());
    const embeddings = getEmbeddings();

    const result = await runUploadIngestion(
      { buffer, fileName: fields.file.name, userId: fields.userId },
      {
        extractPdfText,
        splitText: splitResumeText,
        embedChunks: (chunks) => embeddings.embedDocuments(chunks),
        insertDocuments: async (rows) => {
          const { error } = await getSupabase().from("documents").insert(rows);
          return { error: error ? { message: error.message } : null };
        },
      },
    );

    switch (result.status) {
      case "unparseable-pdf":
        return NextResponse.json(
          { error: "Could not read that file as a PDF." },
          { status: 400 },
        );
      case "empty-pdf":
        // Legacy message — kept stable for existing callers.
        return NextResponse.json({ error: "No text extracted" }, { status: 400 });
      case "backend-error":
        // The insert failed after the probe said alive: a mid-request
        // backend death. Flip the shared cache so subsequent requests
        // (this route and /api/query alike) fail fast up front.
        console.error("[Upload] documents insert failed:", result.message);
        getBackendLiveness().reportDead();
        return NextResponse.json(BACKEND_UNAVAILABLE_PAYLOAD, { status: 503 });
      case "ok":
        return NextResponse.json({
          success: true,
          resumeId: result.resumeId,
          chunks: result.chunks,
        });
    }
  } catch (error: unknown) {
    // Log the full error server-side. Do NOT echo error.message to the
    // client — it can leak Supabase/OpenAI internals (table names, RPC
    // signatures, auth details). Security hardening 2026-05-12.
    console.error("RAG ingestion failed:", error);
    return NextResponse.json(
      { error: "Internal error during upload." },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";
