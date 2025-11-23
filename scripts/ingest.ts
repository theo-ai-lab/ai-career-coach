import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function ingest() {
  const text = fs.readFileSync(path.join(__dirname, '../data/resume.txt'), 'utf-8');

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 200,
  });

  // Fixed line — metadata goes in the second argument now
  const docs = await splitter.createDocuments([text], [
    { metadata: { userId: 'test-user', source: 'resume.txt' } }
  ]);

  const embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
  });

  await SupabaseVectorStore.fromDocuments(docs, embeddings, {
    client,
    tableName: 'documents',
  });

  console.log(`Success! Ingested ${docs.length} chunks into Supabase`);
}

ingest().catch(console.error);
