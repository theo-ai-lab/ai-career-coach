-- Run 01-supabase-documents.sql FIRST. This file assumes the documents table exists
-- with columns (id bigint, content text, embedding vector(1536), metadata jsonb).

-- Create the match_documents RPC function for vector similarity search
-- This function returns documents with metadata for filtering by resume_id

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Grant execute permission to anon role (for API routes)
GRANT EXECUTE ON FUNCTION match_documents(vector, int) TO anon;
GRANT EXECUTE ON FUNCTION match_documents(vector, int) TO authenticated;


-- match_documents_v2: SQL-level scoping by resume_id and/or user_id.
-- Required by /api/query and lib/rag.ts as of 2026-05-04. The original
-- match_documents() above is retained for backward compatibility with
-- callers (e.g. the report graph) that have not yet been migrated.

CREATE OR REPLACE FUNCTION match_documents_v2(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  p_resume_id text DEFAULT NULL,
  p_user_id   text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE
    (p_resume_id IS NULL OR documents.metadata->>'resume_id' = p_resume_id)
    AND (p_user_id IS NULL OR documents.metadata->>'user_id' = p_user_id)
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION match_documents_v2(vector, int, text, text) TO anon;
GRANT EXECUTE ON FUNCTION match_documents_v2(vector, int, text, text) TO authenticated;

-- HNSW index for embedding lives in 01-supabase-documents.sql (canonical).





