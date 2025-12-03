import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    
    // Fetch last 50 evals
    const { data: evals, error: evalsError } = await supabase
      .from('evals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (evalsError) {
      throw new Error(`Failed to fetch evals: ${evalsError.message}`);
    }

    // Calculate average scores
    if (!evals || evals.length === 0) {
      return new Response(
        JSON.stringify({
          evals: [],
          stats: {
            avgActionability: 0,
            avgPersonalization: 0,
            avgHonesty: 0,
            avgGrounding: 0,
            avgOverall: 0,
            totalEvals: 0,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const scores = evals.map((e: any) => e.scores);
    const stats = {
      avgActionability:
        scores.reduce((sum: number, s: any) => sum + (s?.actionability || 0), 0) / evals.length,
      avgPersonalization:
        scores.reduce((sum: number, s: any) => sum + (s?.personalization || 0), 0) / evals.length,
      avgHonesty:
        scores.reduce((sum: number, s: any) => sum + (s?.honesty || 0), 0) / evals.length,
      avgGrounding:
        scores.reduce((sum: number, s: any) => sum + (s?.grounding || 0), 0) / evals.length,
      avgOverall:
        evals.reduce((sum: number, e: any) => sum + (e.overall_score || 0), 0) / evals.length,
      totalEvals: evals.length,
    };

    return new Response(
      JSON.stringify({
        evals: evals.map((e: any) => ({
          id: e.id,
          response_id: e.response_id,
          query: e.query,
          response: e.response,
          contexts: e.contexts || [],
          scores: e.scores,
          reasoning: e.reasoning,
          overall_score: e.overall_score,
          created_at: e.created_at,
        })),
        stats,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Admin evals fetch error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to fetch evals' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

