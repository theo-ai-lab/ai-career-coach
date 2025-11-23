// app/api/upload/route.ts

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import { OpenAIEmbeddings } from '@langchain/openai';

import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';

import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  return createClient(url, key);
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get('file') as File;
    const type = form.get('type') as 'resume' | 'job';

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Import pdf-parse - handle ESM/CommonJS compatibility
    let pdfParse: any;
    try {
      const pdfParseModule = await import('pdf-parse');
      // Try multiple ways to get the function
      pdfParse = pdfParseModule.default || 
                 (pdfParseModule as any).PDFParse || 
                 pdfParseModule;
      
      if (typeof pdfParse !== 'function') {
        throw new Error('pdf-parse module did not export a function');
      }
    } catch (importError: any) {
      throw new Error(`Failed to import pdf-parse: ${importError.message}`);
    }
    
    const result = await pdfParse(buffer);
    const text = result?.text;

    if (!text || text.trim().length === 0) {
      return Response.json({ error: 'No text extracted from PDF' }, { status: 400 });
    }

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 200 });

    const docs = await splitter.createDocuments([text], [{ type }]);

    const supabase = getSupabase();
    const embeddings = new OpenAIEmbeddings({ 
      model: 'text-embedding-3-small',
      openAIApiKey: process.env.OPENAI_API_KEY
    });

    await SupabaseVectorStore.fromDocuments(docs, embeddings, {
      client: supabase,
      tableName: 'documents',
    });

    return Response.json({ success: true, chunks: docs.length });
  } catch (error: any) {
    console.error('Upload error:', error);
    return Response.json({ 
      error: 'Upload failed', 
      details: error.message 
    }, { status: 500 });
  }
}

