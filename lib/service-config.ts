/**
 * service-config.ts
 *
 * Single source of truth for "is the live (key-requiring) coaching path
 * actually configured?". The app's two live routes — /api/query and
 * /api/agents/report — both need an OpenAI key (embeddings + generation +
 * LLM-as-judge) AND a Supabase service-role connection (pgvector retrieval).
 *
 * WHY THIS EXISTS
 * ---------------
 * Honesty gate. Without it, a missing key surfaces as a generic 500 ("Sorry,
 * I encountered an error") AFTER the request has already tried to embed and
 * retrieve — indistinguishable from a real runtime fault, and easy to mistake
 * for a fabricated/empty answer. Checking configuration UP FRONT lets each
 * route return a clear, distinct "not configured" state (HTTP 503) instead of
 * pretending to answer.
 *
 * TESTABILITY
 * -----------
 * Pure: takes an injectable env map (defaults to process.env) and returns
 * booleans only — it NEVER returns or logs the secret values. No DB, no
 * network, no `server-only` import, so it is unit-testable offline.
 */

/** Environment variable names the live path depends on. */
export const REQUIRED_ENV = {
  openai: ['OPENAI_API_KEY'] as const,
  supabase: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const,
};

export interface ServiceConfig {
  /** OpenAI key present (embeddings + generation + judge). */
  openai: boolean;
  /** Supabase URL + service-role key present (pgvector retrieval + writes). */
  supabase: boolean;
  /** True only when every dependency the live path needs is present. */
  ready: boolean;
  /** Names of the env vars that are missing (safe to log; never the values). */
  missing: string[];
}

type EnvLike = Record<string, string | undefined>;

function isSet(env: EnvLike, name: string): boolean {
  const v = env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Inspect the environment for the keys the live coaching path requires.
 *
 * @param env  env map to read (defaults to process.env). Injectable so the
 *             decision logic is exercised offline without real secrets.
 */
export function getServiceConfig(
  env: EnvLike = process.env,
): ServiceConfig {
  const missing: string[] = [];
  for (const name of REQUIRED_ENV.openai) {
    if (!isSet(env, name)) missing.push(name);
  }
  for (const name of REQUIRED_ENV.supabase) {
    if (!isSet(env, name)) missing.push(name);
  }

  const openai = REQUIRED_ENV.openai.every((n) => isSet(env, n));
  const supabase = REQUIRED_ENV.supabase.every((n) => isSet(env, n));

  return {
    openai,
    supabase,
    ready: openai && supabase,
    missing,
  };
}

/**
 * Client-safe payload for the "service not configured" state. Deliberately
 * does NOT enumerate which keys are missing (the route logs that server-side)
 * — the client only needs to know it must render a configuration state rather
 * than a fabricated answer.
 */
export const SERVICE_UNAVAILABLE_PAYLOAD = {
  error: 'service_unavailable',
  configured: false,
  message:
    'The coaching service is not configured. The live answer path requires an OpenAI key and a Supabase connection; set them to enable grounded answers.',
} as const;

/**
 * Client-safe payload for LLM-only routes (the single-agent /api/agents/*
 * endpoints and the eval judge): they need generation but no retrieval, so
 * they gate on `config.openai` alone and their copy must not claim a
 * Supabase connection is required. Same discipline as its sibling: never
 * enumerates env var names.
 */
export const GENERATION_UNAVAILABLE_PAYLOAD = {
  error: 'service_unavailable',
  configured: false,
  message:
    'The generation service is not configured. This endpoint requires an OpenAI key; set it to enable generation.',
} as const;
