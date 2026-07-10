/**
 * backend-liveness.ts
 *
 * Cached liveness checker for the live coaching backend (Supabase). Answers
 * one question cheaply at route start: "is the backend actually reachable
 * right now?" — not just "are its env vars set?" (that is service-config's
 * job).
 *
 * WHY THIS EXISTS
 * ---------------
 * Honesty gate, part two. getServiceConfig() only proves the keys are
 * PRESENT. A deployment whose env vars point at a dead or paused Supabase
 * project passes that check and then fails deep inside retrieval — and until
 * this module existed, the /api/query RPC-error branch masked that failure as
 * HTTP 200 "No relevant experience found.", indistinguishable from an honest
 * empty retrieval. Probing reachability up front (and remembering a
 * mid-request failure via reportDead()) lets the route return its designed
 * 503 service-unavailable state instead of a fabricated-looking answer.
 *
 * DESIGN
 * ------
 * - The probe itself is INJECTED (the route passes a cheap Supabase select),
 *   so this module stays pure: no DB, no network, no key, no `server-only` —
 *   unit-testable offline like the quality-gates layer.
 * - Results are cached for a TTL so one probe amortizes across requests and a
 *   dead backend is never hammered; TTL expiry re-probes, so a revived
 *   backend recovers without a redeploy.
 * - Concurrent checks share a single in-flight probe.
 * - A hanging backend counts as dead: the probe races a timeout so the route
 *   never blocks on a black-holed connection.
 */

/** Why the checker reached its verdict. Server-log-safe, never sent raw to clients. */
export type LivenessReason = 'probe-failed' | 'probe-timeout' | 'reported-dead';

export interface LivenessResult {
  /** True when the backend answered the probe within the timeout. */
  alive: boolean;
  /** 'probe' for a fresh probe, 'cache' when served from the TTL cache. */
  source: 'probe' | 'cache';
  /** Set only when not alive. */
  reason: LivenessReason | null;
}

export interface LivenessCheckerOptions {
  /**
   * Cheap reachability probe: resolve = alive, throw/reject = dead. The
   * caller owns what "reachable" means (e.g. a HEAD select against a known
   * table, so a missing schema also counts as not serving the product).
   */
  probe: () => void | Promise<void>;
  /** How long a verdict (alive or dead) is trusted. Default 30s. */
  ttlMs?: number;
  /** How long the probe may take before counting as dead. Default 2s. */
  timeoutMs?: number;
  /** Injectable clock for offline tests. */
  now?: () => number;
}

export interface LivenessChecker {
  /** Current verdict, probing (once) if the cached one has expired. */
  check(): Promise<LivenessResult>;
  /**
   * Record an observed mid-request backend failure (e.g. the retrieval RPC
   * errored) so subsequent requests fail fast from the cache instead of
   * re-discovering the dead backend. Recovery still happens naturally when
   * the TTL expires and the next check re-probes.
   */
  reportDead(): void;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 2_000;

export function createLivenessChecker(
  options: LivenessCheckerOptions,
): LivenessChecker {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  let cached: { alive: boolean; reason: LivenessReason | null; at: number } | null =
    null;
  let inflight: Promise<LivenessResult> | null = null;

  async function runProbe(): Promise<LivenessResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let verdict: { alive: boolean; reason: LivenessReason | null };
    try {
      await Promise.race([
        // Promise.resolve().then(...) also converts a synchronous throw
        // inside the probe into a rejection instead of an escape.
        Promise.resolve().then(() => options.probe()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('liveness-probe-timeout')),
            timeoutMs,
          );
        }),
      ]);
      verdict = { alive: true, reason: null };
    } catch (err: unknown) {
      const timedOut =
        err instanceof Error && err.message === 'liveness-probe-timeout';
      verdict = {
        alive: false,
        reason: timedOut ? 'probe-timeout' : 'probe-failed',
      };
    } finally {
      clearTimeout(timer);
    }
    cached = { ...verdict, at: now() };
    return { ...verdict, source: 'probe' };
  }

  return {
    async check(): Promise<LivenessResult> {
      if (cached && now() - cached.at < ttlMs) {
        return { alive: cached.alive, reason: cached.reason, source: 'cache' };
      }
      if (!inflight) {
        inflight = runProbe().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    reportDead(): void {
      cached = { alive: false, reason: 'reported-dead', at: now() };
    },
  };
}

/**
 * Client-safe payload for "configured, but the backend is unreachable".
 * Deliberately distinct from service-config's SERVICE_UNAVAILABLE_PAYLOAD
 * (`configured: false`, missing keys): here the keys ARE set and the backend
 * itself is down, so the copy says so honestly. Like its sibling it never
 * enumerates env vars or backend internals — the route logs those
 * server-side. The client's notice surface renders `message` on any non-OK
 * status, so this flows through the same designed failure UI.
 */
export const BACKEND_UNAVAILABLE_PAYLOAD = {
  error: 'service_unavailable',
  configured: true,
  message:
    'The coaching backend is unreachable right now, so I cannot ground an answer in your résumé. Nothing was retrieved or generated for this question — please try again later.',
} as const;
