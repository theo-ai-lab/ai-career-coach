import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@supabase/supabase-js';

import { OpenAIEmbeddings } from '@langchain/openai';

import { ChatOpenAI } from '@langchain/openai';



const supabase = createClient(

  process.env.NEXT_PUBLIC_SUPABASE_URL!,

  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

);



const embeddings = new OpenAIEmbeddings({

  model: 'text-embedding-3-small',

  dimensions: 1536,

});



const llm = new ChatOpenAI({

  model: 'gpt-4o-mini',

  temperature: 0.2,

});



export async function POST(req: NextRequest) {

  const { query } = await req.json();



  const queryEmbedding = await embeddings.embedQuery(query);



  const { data: docs, error } = await supabase.rpc('match_documents', {

    query_embedding: queryEmbedding,

    match_count: 6,

  });



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

}



export const runtime = 'nodejs';

