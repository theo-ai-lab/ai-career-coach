/**
 * grounding/config.ts
 *
 * Single source of truth for "is the grounding gate configured, and how?".
 * Pure: reads an injectable env map and returns plain values — it NEVER logs or
 * returns the secret value (mirrors lib/service-config.ts). No network, no DB,
 * no `server-only` import, so the resolution is unit-testable offline.
 *
 * ENV
 * ---
 *   PACIOLI_RECONCILE_URL      Base URL or full endpoint of Pacioli's reconcile
 *                              route (e.g. http://localhost:3002 or
 *                              https://pacioliapp.vercel.app/api/reconcile).
 *                              UNSET => the gate is disabled and degrades to a
 *                              'skipped' result (never blocks, never fabricates).
 *   PACIOLI_API_KEY            Optional shared secret sent as `x-api-key`.
 *                              Pacioli REQUIRES this to ENABLE the gated judge
 *                              (the semantic CLAIM_MISMATCH check); without it,
 *                              judge selection degrades to 'unauthorized'.
 *   PACIOLI_JUDGE_MODE         off | auto | local | anthropic. Default 'off'
 *                              (deterministic-only). 'auto' prefers on-device
 *                              Ollama, then a hosted key, then deterministic.
 *   PACIOLI_RECONCILE_TIMEOUT_MS  Transport timeout. Default 8000.
 *   PACIOLI_EVIDENCE_LABEL     The evidence "merchant" label. Default 'resume'.
 */

export type JudgeMode = 'off' | 'auto' | 'local' | 'anthropic';

export interface GroundingConfig {
  /** Fully-resolved POST URL for Pacioli's reconcile endpoint. '' => disabled. */
  url: string;
  /** Shared secret for x-api-key, or null. Never logged. */
  apiKey: string | null;
  /** Which CLAIM_MISMATCH judge to request on Pacioli's side. */
  judge: JudgeMode;
  /** Transport timeout in milliseconds. */
  timeoutMs: number;
  /** The evidence source label Pacioli requires (its `merchant` field). */
  evidenceLabel: string;
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 8000;
const JUDGE_MODES: readonly JudgeMode[] = ['off', 'auto', 'local', 'anthropic'];

/**
 * Resolve PACIOLI_RECONCILE_URL to the concrete reconcile endpoint. Accepts
 * either a full endpoint (".../api/reconcile") or a bare origin/base, in which
 * case "/api/reconcile" is appended. Returns '' for an unset or unparseable
 * value — i.e. the gate is treated as disabled rather than throwing.
 */
export function normalizeReconcileUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return ''; // unparseable -> disabled (honest degradation, never throws)
  }
  if (/reconcile/i.test(parsed.pathname)) return trimmed;
  return `${trimmed}/api/reconcile`;
}

function isSet(env: EnvLike, name: string): boolean {
  const v = env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

export function getGroundingConfig(env: EnvLike = process.env): GroundingConfig {
  const url = normalizeReconcileUrl(env.PACIOLI_RECONCILE_URL);
  const apiKey = isSet(env, 'PACIOLI_API_KEY')
    ? (env.PACIOLI_API_KEY as string).trim()
    : null;

  const judgeRaw = (env.PACIOLI_JUDGE_MODE ?? 'off').trim().toLowerCase();
  const judge: JudgeMode = (JUDGE_MODES as readonly string[]).includes(judgeRaw)
    ? (judgeRaw as JudgeMode)
    : 'off';

  const timeoutParsed = Number.parseInt(
    (env.PACIOLI_RECONCILE_TIMEOUT_MS ?? '').trim(),
    10,
  );
  const timeoutMs =
    Number.isFinite(timeoutParsed) && timeoutParsed > 0
      ? timeoutParsed
      : DEFAULT_TIMEOUT_MS;

  const evidenceLabel = isSet(env, 'PACIOLI_EVIDENCE_LABEL')
    ? (env.PACIOLI_EVIDENCE_LABEL as string).trim().slice(0, 200)
    : 'resume';

  return { url, apiKey, judge, timeoutMs, evidenceLabel };
}

/** True iff a reconcile URL is configured (the gate will attempt a round trip). */
export function isGroundingEnabled(config: GroundingConfig): boolean {
  return config.url.length > 0;
}
