import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase-types';

let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null;

// Server-only. Service-role client that bypasses RLS — every caller must
// apply its own user_id / resume_id scoping (Defer-2, 2026-05-14). Must
// never be imported from a "use client" component; importers were audited
// at the time of this change (all route handlers / server libs).
export function getSupabase() {
  if (!supabaseInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    supabaseInstance = createClient<Database>(url, key);
  }
  return supabaseInstance;
}

