import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@supabase/supabase-js';

import { OpenAIEmbeddings } from '@langchain/openai';

import { ChatOpenAI } from '@langchain/openai';



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
    const { query, resumeId } = await req.json();

    const supabase = getSupabaseClient();
    const embeddings = getEmbeddings();
    const llm = getLLM();

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

  const response = await llm.invoke(`
You are an expert AI career coach helping a USC May 2024 graduate land AI APM roles.

CONTEXT FROM RESUME (retrieved_chunks):
${context}

CRITICAL GROUNDING RULES:
- You MUST base every claim on specific details from the context above.
- Before stating that a skill, tool, or domain is missing, SEARCH the entire context for related keywords, abbreviations, and synonyms.
- Never claim a skill is missing if it appears anywhere in the context (for example, if AI ethics or an AI minor is present, do NOT say AI ethics is missing).
- If the context does not contain enough information to answer part of the question, explicitly say "insufficient data in resume context" for that part instead of guessing.

SPECIFICITY REQUIREMENTS:
- Extract and quote specific metrics, numbers, timeframes, and concrete outcomes from the context whenever available.
- Reference actual company names, project names, course titles, and tools exactly as written in the context.
- Do NOT use placeholder phrases like "various projects" or "multiple initiatives"—always use the real names from the context.
- If the resume shows experience in an area, do NOT recommend "gaining experience" in that same area; instead, suggest deepening or extending it.

OUTPUT FORMAT:
- Answer the user's question below in clear markdown.
- Use short sections or bullet points where helpful.
- Where appropriate, briefly indicate your confidence (e.g., "Confidence: high/medium/low") based on how directly the context supports your claims.

USER QUESTION:
${query}

Now provide a concise, professional, and confident answer grounded strictly in the context.`);



  return NextResponse.json({

    answer: response.content,

    sources: docs.map((d: any) => ({ content: d.content, similarity: d.similarity })),

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

