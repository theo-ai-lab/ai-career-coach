import { getUserProfile, UserProfile } from './semantic';
import { getRecentSessions, SessionMemory } from './episodic';

export interface MemoryContext {
  profile: UserProfile | null;
  recentSessions: SessionMemory[];
  formattedContext: string;
}

export async function getMemoryContext(userId: string): Promise<MemoryContext> {
  try {
    const [profile, recentSessions] = await Promise.all([
      getUserProfile(userId),
      getRecentSessions(userId, 3),
    ]);
    
    let formattedContext = '';
    
    if (profile) {
      formattedContext += `## User Profile\n`;
      if (profile.name) formattedContext += `- Name: ${profile.name}\n`;
      if (profile.current_role) formattedContext += `- Current Role: ${profile.current_role}\n`;
      if (profile.target_role) formattedContext += `- Target Role: ${profile.target_role}\n`;
      if (profile.target_companies?.length) {
        formattedContext += `- Target Companies: ${profile.target_companies.join(', ')}\n`;
      }
      if (profile.career_goals) formattedContext += `- Career Goals: ${profile.career_goals}\n`;
      formattedContext += `- Prefers ${profile.communication_style} feedback with ${profile.detail_preference} detail\n\n`;
    }
    
    if (recentSessions.length > 0) {
      formattedContext += `## Recent Conversations\n`;
      recentSessions.forEach((session, i) => {
        formattedContext += `### Session ${i + 1}\n`;
        formattedContext += `${session.summary}\n`;
        if (session.action_items?.length) {
          formattedContext += `Action items: ${session.action_items.join(', ')}\n`;
        }
        formattedContext += '\n';
      });
    }
    
    return { profile, recentSessions, formattedContext };
  } catch (error: any) {
    console.warn('[Memory] Error retrieving memory context:', error.message);
    return { profile: null, recentSessions: [], formattedContext: '' };
  }
}














