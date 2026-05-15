-- Run 01-supabase-documents.sql FIRST. This file assumes the documents table exists
-- with columns (id bigint, content text, embedding vector(1536), metadata jsonb).

-- match_documents v1 (unscoped: no resume_id/user_id filter) was dropped on
-- 2026-05-14. It had no callers in app/ or lib/ but was granted to anon, which
-- would have exposed cross-user resume retrieval if invoked directly. This DROP
-- removes it from databases provisioned before that date.
DROP FUNCTION IF EXISTS match_documents(vector, int);

-- match_documents_v2: SQL-level scoping by resume_id and/or user_id.
-- Required by /api/query, lib/rag.ts, and the resume-analyzer agent. The report
-- graph reaches it indirectly through lib/rag.ts getResumeContextById. This is
-- the only match function; v1 above was removed.

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

-- Defer-2 closure (2026-05-14): EXECUTE is service_role-only. Anon and
-- authenticated grants removed because every caller
-- (app/api/query/route.ts, lib/rag.ts, lib/agents/resume-analyzer/node.ts)
-- constructs its Supabase client with SUPABASE_SERVICE_ROLE_KEY server-side.
-- REVOKE FROM PUBLIC is belt-and-suspenders: Postgres defaults grant EXECUTE
-- on new functions to PUBLIC, so an explicit revoke makes the lockdown
-- visible at re-run and resilient to anyone re-running CREATE OR REPLACE.
REVOKE EXECUTE ON FUNCTION match_documents_v2(vector, int, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION match_documents_v2(vector, int, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION match_documents_v2(vector, int, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION match_documents_v2(vector, int, text, text) TO service_role;

-- HNSW index for embedding lives in 01-supabase-documents.sql (canonical).





