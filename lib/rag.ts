import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { ChatOpenAI } from '@langchain/openai';

// Lazy initialization to avoid crashes if env vars are missing
let supabaseInstance: ReturnType<typeof createClient> | null = null;
let embeddingsInstance: OpenAIEmbeddings | null = null;

function getSupabaseClient() {
  if (!supabaseInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables');
    }
    supabaseInstance = createClient(url, key);
  }
  return supabaseInstance;
}

function getEmbeddings() {
  if (!embeddingsInstance) {
    embeddingsInstance = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
  }
  return embeddingsInstance;
}

/**
 * Retrieves resume context chunks from Supabase using RAG
 * @param resumeId - The resume ID to filter by
 * @param maxChunks - Maximum number of chunks to return (default: 12)
 * @returns Object with chunks array and rawDocs array
 */
export async function getResumeContextById(
  resumeId: string,
  maxChunks = 12
): Promise<{
  chunks: string[];
  rawDocs: any[];
}> {
  const supabase = getSupabaseClient();
  const embeddings = getEmbeddings();
  
  // Use a neutral embedding query to get representative chunks
  const queryText = 'full resume overview';
  const queryEmbedding = await embeddings.embedQuery(queryText);

  // Get documents using match_documents RPC
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_count: resumeId ? 30 : maxChunks, // Get more if filtering to ensure we have enough after filter
  } as any);

  const allDocs = data as any[] | null;

  if (error) {
    throw new Error(`Failed to retrieve documents: ${error.message}`);
  }

  // Filter by resume_id in metadata if provided
  const docs = resumeId && allDocs
    ? allDocs.filter((doc: any) => doc.metadata?.resume_id === resumeId).slice(0, maxChunks)
    : allDocs?.slice(0, maxChunks) || [];

  if (!docs || docs.length === 0) {
    throw new Error(`No documents found for resumeId: ${resumeId}`);
  }

  return {
    chunks: docs.map((d: any) => d.content),
    rawDocs: docs,
  };
}

/**
 * Returns a configured ChatOpenAI client (same config as /api/query)
 */
export function getChatClient(): ChatOpenAI {
  return new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.2,
  });
}

