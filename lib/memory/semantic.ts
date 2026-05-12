import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase-types';

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
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    
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
  } catch (error: any) {
    console.warn('[Memory] Error fetching profile:', error.message);
    return null;
  }
}

export async function upsertUserProfile(profile: UserProfile): Promise<void> {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    
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
  } catch (error: any) {
    console.warn('[Memory] Error upserting profile:', error.message);
  }
}
