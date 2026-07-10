import 'server-only';

import { getSupabase } from '@/lib/supabase';
import {
  createLivenessChecker,
  type LivenessChecker,
} from '@/lib/backend-liveness';

/**
 * backend-liveness-server.ts
 *
 * The ONE process-wide backend-liveness gate every Supabase-touching route
 * shares (honesty gate, part two). getServiceConfig() only proves the env
 * vars are PRESENT; a deployment whose vars point at a dead or paused
 * Supabase project passes that check and then fails deep inside retrieval
 * or ingestion. This cached probe (a cheap HEAD select against the
 * documents table) catches that state up front so each route can return
 * its designed 503 instead of a failure dressed up as an answer — and it
 * runs BEFORE any OpenAI call, so a dead backend also spends nothing.
 *
 * Shared on purpose: one TTL cache means one probe amortizes across ALL
 * routes in the instance, and a mid-request failure reported by one route
 * (reportDead) fast-fails the others until the TTL expires and the next
 * check re-probes. Per-instance and in-memory, like the gate counters.
 *
 * The decision logic lives in lib/backend-liveness.ts (pure, unit-tested
 * offline); this module only binds it to the real Supabase client, so it
 * stays as thin as lib/supabase.ts itself.
 */

const checker: LivenessChecker = createLivenessChecker({
  probe: async () => {
    const { error } = await getSupabase()
      .from('documents')
      .select('id', { head: true })
      .limit(1);
    // A PostgREST-level error (missing table/schema) also means the backend
    // is not serving the product — treat it as dead, not just fetch failures.
    if (error) throw new Error(error.message);
  },
});

/** The process-wide liveness gate. Callers use .check() and .reportDead(). */
export function getBackendLiveness(): LivenessChecker {
  return checker;
}
