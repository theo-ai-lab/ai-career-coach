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

Use ONLY the following context from the candidate's background:



${context}



Question: ${query}



Answer concisely, professionally, and confidently. Never hallucinate.`);



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

