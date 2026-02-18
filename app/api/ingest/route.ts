import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@supabase/supabase-js';

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(url, key);
}

export async function POST(req: NextRequest) {

  const formData = await req.formData();

  const file = formData.get('file') as File;

  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });



  const buffer = await file.arrayBuffer();

  const loader = new PDFLoader(new Blob([buffer]));

  const docs = await loader.load();



  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 200 });

  const chunks = await splitter.splitDocuments(docs);

  const supabase = getSupabaseClient();

  const { error } = await supabase.from('documents').insert(

    chunks.map(chunk => ({

      content: chunk.pageContent,

      metadata: { source: 'uploaded_resume', ...chunk.metadata }

    })) as any

  );



  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });

}

