import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import { ChatOpenAI } from '@langchain/openai';
import type { Database, MatchDocumentsResult } from '@/lib/supabase-types';

// Lazy initialization to avoid crashes if env vars are missing
let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null;
let embeddingsInstance: OpenAIEmbeddings | null = null;

// Server-only. Service-role client that bypasses RLS — every caller must
// apply its own resume_id / user_id scoping (Defer-2, 2026-05-14). Must
// never be imported from a "use client" component; importers were audited
// at the time of this change (all route handlers / server libs).
function getSupabaseClient() {
  if (!supabaseInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }
    supabaseInstance = createClient<Database>(url, key);
  }
  return supabaseInstance;
}

export function getEmbeddings() {
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
  rawDocs: MatchDocumentsResult[];
}> {
  const supabase = getSupabaseClient();
  const embeddings = getEmbeddings();

  // Use a neutral embedding query to get representative chunks
  const queryText = 'full resume overview';
  const queryEmbedding = await embeddings.embedQuery(queryText);

  const { data, error } = await supabase.rpc('match_documents_v2', {
    query_embedding: queryEmbedding,
    match_count: maxChunks,
    p_resume_id: resumeId || null,
    p_user_id: null,
  });

  if (error) {
    throw new Error(`Failed to retrieve documents: ${error.message}`);
  }

  const docs = data ?? [];

  if (docs.length === 0) {
    throw new Error(`No documents found for resumeId: ${resumeId}`);
  }

  return {
    chunks: docs.map((d) => d.content),
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

/**
 * Returns a ChatOpenAI client tuned for LLM-as-judge usage:
 * temperature 0 for reproducible scoring across runs.
 */
export function getJudgeClient(): ChatOpenAI {
  return new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0,
  });
}

