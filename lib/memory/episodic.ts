import { ChatOpenAI } from '@langchain/openai';
import { getSupabase } from '@/lib/supabase';

// Local exported shape used by callers. The DB column sentiment is TEXT
// (no enum constraint), so reads can return any string or null. The
// literal union from earlier versions was aspirational, not enforced.
export interface SessionMemory {
  user_id: string;
  session_id: string;
  summary: string;
  key_decisions?: string[];
  topics_discussed?: string[];
  action_items?: string[];
  sentiment?: string | null;
}

export async function getRecentSessions(userId: string, limit: number = 5): Promise<SessionMemory[]> {
  // Hoisted outside try/catch so a missing SUPABASE_SERVICE_ROLE_KEY
  // propagates as a 5xx instead of being swallowed as a console warning
  // (previous behavior silently fell back to the anon key, which then
  // failed RLS denials at query time — invisible to operators).
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('session_memories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.warn('[Memory] Failed to fetch sessions:', error.message);
      return [];
    }
    
    return data || [];
  } catch (error: any) {
    console.warn('[Memory] Error fetching sessions:', error.message);
    return [];
  }
}

// Fire-and-forget session summarization (zero latency impact)
export function summarizeSessionAsync(
  userId: string,
  sessionId: string,
  messages: Array<{ role: string; content: string }>
): void {
  // Validate env synchronously before kicking off the fire-and-forget IIFE.
  // A missing SUPABASE_SERVICE_ROLE_KEY here surfaces as a synchronous throw
  // into the calling route, rather than completing the response while
  // silently dropping the session summary (previous fallback-to-anon
  // behavior produced an RLS denial that was logged and ignored).
  const supabase = getSupabase();
  (async () => {
    try {
      const llm = new ChatOpenAI({
        model: 'gpt-4o-mini',
        temperature: 0.3,
      });
      
      const conversationText = messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');
      
      const prompt = `Analyze this career coaching conversation and extract:

1. A 2-sentence summary
2. Key decisions made (if any)
3. Topics discussed
4. Action items for the user
5. User's emotional sentiment (positive/neutral/frustrated/anxious)

Conversation:

${conversationText}

Return JSON:

{
  "summary": "...",
  "key_decisions": ["..."],
  "topics_discussed": ["..."],
  "action_items": ["..."],
  "sentiment": "..."
}`;
      
      const response = await llm.invoke(prompt);
      const content = response.content.toString();
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[Memory] No JSON found in summarization response');
        return;
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      const { error: insertError } = await supabase.from('session_memories').insert({
        user_id: userId,
        session_id: sessionId,
        summary: parsed.summary,
        key_decisions: parsed.key_decisions || [],
        topics_discussed: parsed.topics_discussed || [],
        action_items: parsed.action_items || [],
        sentiment: parsed.sentiment || 'neutral',
      });
      
      if (insertError) {
        console.warn('[Memory] Failed to insert session memory:', insertError.message);
      } else {
        console.log('[Memory] Session summarized:', sessionId);
      }
    } catch (err: any) {
      console.warn('[Memory] Session summarization failed:', err.message);
    }
  })().catch(err => {
    // Silently handle any uncaught errors in fire-and-forget
    console.warn('[Memory] Unhandled error in session summarization:', err.message);
  });
}

