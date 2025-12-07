import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@supabase/supabase-js';

import { OpenAIEmbeddings } from '@langchain/openai';

import { ChatOpenAI } from '@langchain/openai';

import { getMemoryContext, summarizeSessionAsync } from '@/lib/memory';

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
      match_count: resumeId ? 20 : 6, // Get more if filtering to ensure we have enough after filter
    });

    // Filter by resume_id in metadata if provided
    const docs = resumeId && allDocs 
      ? allDocs.filter((doc: any) => doc.metadata?.resume_id === resumeId).slice(0, 6)
      : allDocs;

    if (error || !docs || docs.length === 0) {
      return NextResponse.json({ answer: 'No relevant experience found.' });
    }

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
      sessionId: currentSessionId, // Return sessionId so frontend can track it
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

