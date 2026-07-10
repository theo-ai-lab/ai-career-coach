import { NextResponse } from "next/server";

import { getServiceConfig } from "@/lib/service-config";
import { getBackendLiveness } from "@/lib/backend-liveness-server";

/**
 * GET /api/health — keyless, spend-free health surface for post-deploy
 * verification (scripts/verify-live.mjs) and uptime monitoring.
 *
 * Reports the same truths the honesty gates enforce, without any OpenAI
 * call:
 *   - status: "ok" only when the live path is configured AND the Supabase
 *     backend answered the shared cached liveness probe; "degraded"
 *     otherwise. The keyless /demo path is available either way.
 *   - live.configured: env presence for the live path (never WHICH vars).
 *   - live.backendAlive: probe verdict; null when the Supabase env is not
 *     set (nothing to probe).
 *
 * Always HTTP 200: this route reports on the app's dependencies, and the
 * app process itself is serving — a deliberately keyless demo deployment
 * must not be flagged dead by an uptime monitor. Degradation lives in the
 * body. Never leaks env var names, URLs, or backend errors (the routes log
 * those server-side).
 */
export async function GET() {
  const config = getServiceConfig();

  let backendAlive: boolean | null = null;
  if (config.supabase) {
    backendAlive = (await getBackendLiveness().check()).alive;
  }

  return NextResponse.json({
    status: config.ready && backendAlive === true ? "ok" : "degraded",
    demo: { available: true },
    live: {
      configured: config.ready,
      backendAlive,
    },
  });
}

export const runtime = "nodejs";
// A GET handler with no dynamic API usage could be evaluated at build time,
// baking the BUILD environment's config into the response. Force per-request
// evaluation.
export const dynamic = "force-dynamic";
