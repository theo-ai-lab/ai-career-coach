import { NextRequest } from 'next/server';
import { evaluateCoachingQuality, CoachingQualityInput } from '@/lib/evals/coaching-quality';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, response, contexts, responseId } = body;

    // Validate required fields
    if (!query || !response || !Array.isArray(contexts)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: query, response, contexts' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Run evaluation
    const evalResult = await evaluateCoachingQuality({
      query,
      response,
      contexts,
    } as CoachingQualityInput);

    // Store in Supabase
    const supabase = getSupabase();
    const { error: dbError } = await supabase
      .from('evals')
      .insert({
        response_id: responseId || null,
        query,
        response,
        contexts,
        scores: evalResult.scores,
        reasoning: evalResult.reasoning,
        overall_score: evalResult.overall,
      } as any);

    if (dbError) {
      console.error('Failed to store eval in Supabase:', dbError);
      // Don't fail the request if DB write fails, just log it
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...evalResult,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Coaching quality eval error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to evaluate coaching quality' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

