import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit-server";
import { getResumeContextById, getChatClient } from "@/lib/rag";
import {
  getServiceConfig,
  SERVICE_UNAVAILABLE_PAYLOAD,
} from "@/lib/service-config";
import { BACKEND_UNAVAILABLE_PAYLOAD } from "@/lib/backend-liveness";
import { getBackendLiveness } from "@/lib/backend-liveness-server";
import type { JobMatch } from "@/lib/agents/job-matcher/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  resumeId: string;
  jobDescription: string;
}

/**
 * Helper to safely parse JSON from LLM responses.
 * Strips code fences and extracts the first JSON object.
 */
function parseJsonResponse(content: string): unknown {
  // Remove markdown code blocks if present
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }

  // Try to extract JSON object from content
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response");
  }

  const jsonStr = jsonMatch[0];
  return JSON.parse(jsonStr);
}

export async function POST(req: NextRequest) {
  // Per-IP rate gate FIRST — before body parsing, before the honesty
  // gates, before any OpenAI spend (lib/rate-limit.ts).
  const limited = enforceRateLimit(req, "agents");
  if (limited) return limited;

  try {
    const body: RequestBody = await req.json();
    const { resumeId, jobDescription } = body;

    if (!resumeId) {
      return Response.json(
        { error: "Missing required field: resumeId" },
        { status: 400 },
      );
    }

    if (!jobDescription || !jobDescription.trim()) {
      return Response.json(
        { error: "Missing required field: jobDescription" },
        { status: 400 },
      );
    }

    // Honesty gate: this route needs an OpenAI key AND the Supabase backend
    // (pgvector retrieval). Missing keys -> designed 503; keys present but
    // backend dead (shared cached probe) -> designed 503 — both BEFORE any
    // OpenAI spend, never a generic 500 from deep inside retrieval.
    const config = getServiceConfig();
    if (!config.ready) {
      console.warn(
        "[JobMatcher] Service not configured; missing env:",
        config.missing.join(", "),
      );
      return Response.json(SERVICE_UNAVAILABLE_PAYLOAD, { status: 503 });
    }
    const liveness = await getBackendLiveness().check();
    if (!liveness.alive) {
      console.error(
        "[JobMatcher] Backend liveness check failed:",
        liveness.reason,
        `(${liveness.source})`,
      );
      return Response.json(BACKEND_UNAVAILABLE_PAYLOAD, { status: 503 });
    }

    // Step 1: Retrieve resume context via RAG
    let chunks: string[];
    try {
      const result = await getResumeContextById(resumeId, 12);
      chunks = result.chunks;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message?.includes("No documents found for resumeId")
      ) {
        return Response.json(
          {
            error:
              "No resume chunks found for the provided resumeId. Please upload a resume again.",
          },
          { status: 400 },
        );
      }
      throw error;
    }

    const resumeContext = chunks.join("\n\n");

    const llm = getChatClient();

    const prompt = `You are a job matching specialist. You will be given:

RESUME CONTEXT:
${resumeContext}

JOB DESCRIPTION:
${jobDescription}

CRITICAL GROUNDING RULES:
- ONLY use information from the provided RESUME CONTEXT. Do not invent or assume any experience that is not clearly supported there.
- When you claim a "strong match", you must be able to point to specific evidence from the resume context (e.g., projects, roles, achievements).
- When you list a "gap", it should be something that is clearly requested or implied by the JOB DESCRIPTION and not present in the resume context.
- If the job description is vague or missing details in some areas, mark those as "insufficient data" instead of guessing.

COMPARISON INSTRUCTIONS:
- Carefully read the JOB DESCRIPTION and extract the concrete requirements, responsibilities, and preferred qualifications.
- For each major requirement, search the RESUME CONTEXT for explicit or closely related evidence.
- Be specific about tools, technologies, domains, and years of experience when possible.

OUTPUT FORMAT:
Return a single JSON object with this exact shape:
{
  "matchScore": 0-100,
  "strongMatches": ["specific requirement that is strongly matched", "..."],
  "gaps": ["specific requirement that is missing or weakly supported", "..."],
  "keywordsToAdd": ["keyword or phrase that appears in the job description but not clearly in the resume", "..."],
  "talkingPoints": ["concrete talking point mapping their past experience to this role", "..."]
}

Additional formatting rules:
- Return ONLY valid JSON, no markdown or explanation outside the JSON.
- Do NOT wrap the JSON in code fences.
- If something is unclear from the resume, prefer "insufficient data" over hallucinating.`;

    const response = await llm.invoke(prompt);
    const rawContent = response.content.toString();

    let match: JobMatch;
    try {
      match = parseJsonResponse(rawContent) as JobMatch;
    } catch (error: unknown) {
      console.error("Job matcher: failed to parse model response", error);
      return Response.json(
        {
          error: "Failed to parse job matching results from model response.",
        },
        { status: 500 },
      );
    }

    return Response.json({ success: true, match });
  } catch (error: unknown) {
    console.error("Job matcher agent error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
