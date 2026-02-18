import { createClient } from '@supabase/supabase-js';
import { ChatOpenAI } from '@langchain/openai';

export interface SessionMemory {
  user_id: string;
  session_id: string;
  summary: string;
  key_decisions?: string[];
  topics_discussed?: string[];
  action_items?: string[];
  sentiment?: 'positive' | 'neutral' | 'frustrated' | 'anxious';
}

export async function getRecentSessions(userId: string, limit: number = 5): Promise<SessionMemory[]> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    
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
  // Don't block - run in background (fire-and-forget)
  (async () => {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      
      const llm = new ChatOpenAI({
        modelName: 'gpt-4o-mini',
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
      } as any);
      
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

