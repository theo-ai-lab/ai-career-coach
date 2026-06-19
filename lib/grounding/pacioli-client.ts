/**
 * grounding/pacioli-client.ts
 *
 * The TRANSPORT for the grounding gate: a single real HTTP POST to Pacioli's
 * batch /api/reconcile endpoint and a validated parse of the response. This is
 * the genuine cross-component call — no re-implementation of Pacioli's engine,
 * no hardcoded verdicts.
 *
 * GRACEFUL DEGRADATION IS THE CONTRACT
 * ------------------------------------
 * This function NEVER throws into the caller and NEVER fabricates a verdict.
 * Every failure mode (unreachable host, timeout, non-2xx, non-JSON, or a body
 * that does not match Pacioli's documented shape) returns a typed
 * `{ ok: false, reason }` so the orchestrator can surface an honest
 * 'unavailable' state instead of a fake pass.
 *
 * `fetchImpl` is injectable so the whole round trip is exercised offline with a
 * mocked transport (lib/grounding/grounding.test.ts).
 */

import { z } from 'zod';
import type { PacioliClaimEntry, PacioliEvidence } from './types';

// Pacioli's batch response shape (lib/api/reconcile-endpoint.ts on Pacioli).
// `.passthrough()` keeps us tolerant of additive fields Pacioli may add later
// without breaking the parse — we validate only what we consume.
const FindingSchema = z
  .object({
    type: z.string(),
    dimension: z.string().optional(),
    severity: z.string().optional(),
    claimedRef: z.string().optional(),
    actualRef: z.string().optional(),
    llmAssisted: z.boolean().optional(),
    note: z.string().optional(),
  })
  .passthrough();

const ClaimVerdictSchema = z
  .object({
    id: z.string(),
    agent: z.string().optional(),
    status: z.enum(['supported', 'unsupported', 'overclaim']),
    balanced: z.boolean(),
    findings: z.array(FindingSchema).default([]),
    judgeFindings: z.array(FindingSchema).default([]),
    deltaUsd: z.number().nullable().optional(),
    likelyCause: z.string().nullable().optional(),
    receiptId: z.string().optional(),
    receiptHash: z.string().optional(),
  })
  .passthrough();

export const ReconcileBatchResponseSchema = z
  .object({
    merchant: z.string().optional(),
    judgeMode: z.string().optional(),
    claims: z.array(ClaimVerdictSchema),
    summary: z.object({
      total: z.number(),
      supported: z.number(),
      unsupported: z.number(),
      overclaim: z.number(),
    }),
  })
  .passthrough();

export type ReconcileBatchResponse = z.infer<typeof ReconcileBatchResponseSchema>;
export type ReconcileClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

export type ReconcileOutcome =
  | { ok: true; body: ReconcileBatchResponse }
  /**
   * reason ∈ 'timeout' | 'network-error' | `http-<status>` | 'invalid-json'
   *        | 'unexpected-shape'. Surfaced for logging; the gate maps it to an
   *        'unavailable' result.
   */
  | { ok: false; reason: string };

export interface ReconcileRequest {
  url: string;
  apiKey: string | null;
  judge: string;
  claims: PacioliClaimEntry[];
  evidence: PacioliEvidence;
  timeoutMs: number;
  /** Optional per-session ledger partition (Pacioli's x-pacioli-session). */
  sessionKey?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * POST a batch of claims + shared evidence to Pacioli and return a validated
 * verdict, or a typed failure. Does not throw.
 */
export async function reconcileClaims(
  req: ReconcileRequest,
): Promise<ReconcileOutcome> {
  const doFetch = req.fetchImpl ?? fetch;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (req.apiKey) headers['x-api-key'] = req.apiKey;
  if (req.sessionKey) headers['x-pacioli-session'] = req.sessionKey.slice(0, 200);

  const body = JSON.stringify({
    claims: req.claims,
    evidence: req.evidence,
    judge: req.judge,
  });

  let res: Response;
  try {
    res = await doFetch(req.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (error: unknown) {
    // AbortSignal.timeout rejects with a TimeoutError; everything else
    // (DNS/connection refused/etc.) is a network error. Either way: honest miss.
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : 'network-error';
    return { ok: false, reason };
  }

  if (!res.ok) return { ok: false, reason: `http-${res.status}` };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }

  const parsed = ReconcileBatchResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'unexpected-shape' };

  return { ok: true, body: parsed.data };
}
