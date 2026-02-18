import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@supabase/supabase-js';

import { OpenAIEmbeddings } from '@langchain/openai';

import { ChatOpenAI } from '@langchain/openai';

import { getMemoryContext, summarizeSessionAsync } from '@/lib/memory';

import { evaluateCoachingQuality } from '@/lib/evals/coaching-quality';

import { randomUUID } from 'crypto';



function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(url, key);
}

function getEmbeddings() {
  return new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    dimensions: 1536,
  });
}

function getLLM() {
  return new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.2,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { query, resumeId, sessionId, messages } = await req.json();

    const supabase = getSupabaseClient();
    const embeddings = getEmbeddings();
    const llm = getLLM();

    // Use resumeId as userId for memory system
    const userId = resumeId || 'anonymous';
    const currentSessionId = sessionId || randomUUID();

    // Retrieve memory context (non-blocking, returns empty if fails)
    let memoryContext;
    try {
      memoryContext = await getMemoryContext(userId);
    } catch (memoryError: any) {
      console.warn('[Memory] Failed to retrieve memory context:', memoryError.message);
      memoryContext = { profile: null, recentSessions: [], formattedContext: '' };
    }

    const queryEmbedding = await embeddings.embedQuery(query);

    // Get documents (we'll filter by resume_id after if provided)
    const { data: allDocs, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_count: resumeId ? 20 : 6,
    } as any);

    // Debug logging
    console.log('[Query] Request received - resumeId:', resumeId, 'query:', query.substring(0, 50));
    if (resumeId) {
      console.log('[Query] resumeId provided:', resumeId);
      console.log('[Query] allDocs count:', allDocs?.length || 0);
      if (allDocs && allDocs.length > 0) {
        console.log('[Query] Sample doc metadata:', JSON.stringify(allDocs[0].metadata, null, 2));
        console.log('[Query] Sample doc resume_id:', allDocs[0].metadata?.resume_id);
      } else {
        console.log('[Query] WARNING: No documents returned from match_documents RPC');
      }
    } else {
      console.log('[Query] WARNING: No resumeId provided in request');
    }

    // Filter by resume_id in metadata if provided
    const docs = resumeId && allDocs 
      ? allDocs.filter((doc: any) => {
          const docResumeId = doc.metadata?.resume_id;
          const matches = docResumeId === resumeId;
          if (!matches && docResumeId) {
            console.log(`[Query] Mismatch - doc resume_id: "${docResumeId}" vs query resumeId: "${resumeId}"`);
          }
          return matches;
        }).slice(0, 6)
      : allDocs;

    if (error) {
      console.error('[Query] RPC error:', error);
      return NextResponse.json({ answer: 'No relevant experience found.' });
    }

    if (!docs || docs.length === 0) {
      console.log('[Query] No documents found after filtering. resumeId:', resumeId, 'allDocs count:', allDocs?.length || 0);
      
      // TEMPORARY: If filtering fails but we have docs, use them anyway (for debugging)
      if (allDocs && allDocs.length > 0 && resumeId) {
        console.log('[Query] FALLBACK: Using allDocs without filtering (debugging mode)');
        const fallbackDocs = allDocs.slice(0, 6);
        const context = fallbackDocs.map((d: any) => d.content).join('\n\n');
        
        // Continue with response generation using fallback docs
        let systemPrompt = `You are an expert AI career coach helping candidates land their dream roles.

Use ONLY the following context from the candidate's background:

${context}

Question: ${query}

Answer concisely, professionally, and confidently. Never hallucinate.`;

        const response = await llm.invoke(systemPrompt);
        const answer = response.content.toString();
        
        return NextResponse.json({
          answer,
          sources: fallbackDocs.map((d: any) => ({ content: d.content, similarity: d.similarity })),
          sessionId: currentSessionId,
        });
      }
      
      return NextResponse.json({ answer: 'No relevant experience found.' });
    }

    console.log('[Query] Found', docs.length, 'documents after filtering');

    const context = docs.map((d: any) => d.content).join('\n\n');

    // Build system prompt with memory context
    let systemPrompt = `You are an expert AI career coach helping candidates land their dream roles.

Use ONLY the following context from the candidate's background:

${context}`;

    // Inject memory context if available
    if (memoryContext.formattedContext) {
      systemPrompt += `\n\n## What You Remember About This User\n${memoryContext.formattedContext}`;
    }

    // Add communication style guidance
    if (memoryContext.profile?.communication_style === 'direct') {
      systemPrompt += '\n\nBe direct and concise in your feedback.';
    } else if (memoryContext.profile?.communication_style === 'encouraging') {
      systemPrompt += '\n\nBe supportive and encouraging while giving feedback.';
    } else {
      systemPrompt += '\n\nBalance honesty with encouragement.';
    }

    // Add natural memory reference instructions
    if (memoryContext.profile || memoryContext.recentSessions.length > 0) {
      systemPrompt += `\n\nIf you have memory of previous conversations with this user, naturally reference it like:
"Based on our last conversation about transitioning to product management..."
"I remember you mentioned concerns about your technical background..."
${memoryContext.profile?.target_companies?.[0] ? `"Since you're targeting ${memoryContext.profile.target_companies[0]}..."` : ''}

Do NOT say "According to my memory" or "My records show" - be natural.`;
    }

    systemPrompt += `\n\nQuestion: ${query}\n\nAnswer concisely, professionally, and confidently. Never hallucinate.`;

    const response = await llm.invoke(systemPrompt);
    const answer = response.content.toString();

    // Evaluate response quality (fire-and-forget, but we'll await it to return scores)
    let evalResult = null;
    try {
      evalResult = await evaluateCoachingQuality({
        query,
        response: answer,
        contexts: docs.map((d: any) => d.content),
      });
      
      // Store eval in Supabase (non-blocking)
      try {
        const supabase = getSupabaseClient();
        await supabase.from('evals').insert({
          response_id: `${currentSessionId}-query`,
          query,
          response: answer,
          contexts: docs.map((d: any) => d.content),
          scores: evalResult.scores,
          reasoning: evalResult.reasoning,
          overall_score: evalResult.overall,
        } as any);
      } catch (dbError: any) {
        console.warn('[Eval] Failed to store eval:', dbError.message);
        // Don't fail if DB write fails
      }
    } catch (evalError: any) {
      console.warn('[Eval] Failed to evaluate response:', evalError.message);
      // Continue without scores if evaluation fails
    }

    // Fire-and-forget session summarization (zero latency impact)
    if (messages && Array.isArray(messages) && messages.length > 0) {
      // Include current query and response in messages for summarization
      const messagesForSummary = [
        ...messages,
        { role: 'user', content: query },
        { role: 'assistant', content: answer }
      ];
      summarizeSessionAsync(userId, currentSessionId, messagesForSummary);
    } else {
      // If no message history provided, summarize just this exchange
      summarizeSessionAsync(userId, currentSessionId, [
        { role: 'user', content: query },
        { role: 'assistant', content: answer }
      ]);
    }

    return NextResponse.json({
      answer,
      sources: docs.map((d: any) => ({ content: d.content, similarity: d.similarity })),
      sessionId: currentSessionId,
      scores: evalResult ? {
        overall: evalResult.overall,
        actionability: evalResult.scores.actionability,
        personalization: evalResult.scores.personalization,
        honesty: evalResult.scores.honesty,
        grounding: evalResult.scores.grounding,
      } : null,
    });

  } catch (error: any) {
    console.error('Query error:', error);
    return NextResponse.json({ 
      answer: 'Sorry, I encountered an error processing your query.',
      error: error.message 
    }, { status: 500 });
  }
}



export const runtime = 'nodejs';

