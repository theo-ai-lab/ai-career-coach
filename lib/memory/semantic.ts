import { getSupabase } from '@/lib/supabase';

// Local exported shape used by callers. Allows `string | null` on the
// nullable text columns (per the SQL — no NOT NULL on most fields) so
// reads from the typed Supabase client round-trip cleanly. The literal
// union types previously declared here for communication_style and
// detail_preference are narrowed at the call site in
// app/api/query/route.ts (`if (memoryContext.profile?.communication_style
// === 'direct')`) — runtime values still come from the DB as TEXT.
export interface UserProfile {
  user_id: string;
  name?: string | null;
  current_role?: string | null;
  target_role?: string | null;
  target_companies?: string[];
  skills?: string[];
  career_goals?: string | null;
  communication_style?: string;
  detail_preference?: string;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  // Hoisted outside try/catch so a missing SUPABASE_SERVICE_ROLE_KEY
  // propagates as a 5xx instead of being swallowed as a console warning
  // (previous behavior silently fell back to the anon key, which then
  // failed RLS denials at query time — invisible to operators).
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.warn('[Memory] Failed to fetch profile:', error.message);
      return null;
    }
    
    return data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Memory] Error fetching profile:', message);
    return null;
  }
}

export async function upsertUserProfile(profile: UserProfile): Promise<void> {
  // See getUserProfile comment: env-missing must propagate, not log-and-swallow.
  const supabase = getSupabase();
  try {
    const { error } = await supabase
      .from('user_profiles')
      .upsert(
        { ...profile, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    
    if (error) {
      console.warn('[Memory] Failed to upsert profile:', error.message);
    } else {
      console.log('[Memory] Profile updated for user:', profile.user_id);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Memory] Error upserting profile:', message);
  }
}
