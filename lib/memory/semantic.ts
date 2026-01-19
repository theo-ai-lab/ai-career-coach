import { createClient } from '@supabase/supabase-js';

export interface UserProfile {
  user_id: string;
  name?: string;
  current_role?: string;
  target_role?: string;
  target_companies?: string[];
  skills?: string[];
  career_goals?: string;
  communication_style?: 'direct' | 'encouraging' | 'balanced';
  detail_preference?: 'brief' | 'moderate' | 'detailed';
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const supabase = createClient(
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
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        ...profile,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    
    if (error) {
      console.warn('[Memory] Failed to upsert profile:', error.message);
    } else {
      console.log('[Memory] Profile updated for user:', profile.user_id);
    }
  } catch (error: any) {
    console.warn('[Memory] Error upserting profile:', error.message);
  }
}











