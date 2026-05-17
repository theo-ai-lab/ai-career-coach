-- Documents table for resume RAG storage.
-- Load order is encoded in the numeric filename prefixes (01-, 02-, ...).
-- Running these SQL files in alphabetical order honors the dependency chain.
-- The vector(1536) column matches OpenAI text-embedding-3-small output (see lib/rag.ts).

-- pgvector extension provides the vector type and similarity operators.
CREATE EXTENSION IF NOT EXISTS vector;

-- Resume chunks indexed for cosine similarity search.
-- metadata JSONB stores { source: text, user_id: text, resume_id: text }.
-- See app/api/upload/route.ts for the insert shape.
CREATE TABLE IF NOT EXISTS documents (
  id          BIGSERIAL PRIMARY KEY,
  content     TEXT NOT NULL,
  embedding   VECTOR(1536) NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for fast cosine-similarity nearest-neighbor search.
-- Better recall than IVFFlat at our scale (<10k chunks/user). See docs/DECISION_LOG.md decision 1.
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents
  USING hnsw (embedding vector_cosine_ops);

-- GIN index for fast JSONB filters on metadata->>'resume_id' and metadata->>'user_id'.
-- match_documents_v2 (02-supabase-match-documents.sql) filters on these.
CREATE INDEX IF NOT EXISTS documents_metadata_gin_idx
  ON documents
  USING gin (metadata);

-- Row-Level Security: enable now; the canonical service_role policy lives in
-- 05-supabase-fix.sql. Security remediation 2026-05-14: the previous
-- "allow anon insert" + "allow anon select" defaults let any anon-key holder
-- read every user's resume chunks via a direct
-- supabase.from('documents').select('*') call, bypassing the resume_id
-- scoping in match_documents_v2. Removed entirely; all server access now goes
-- through SUPABASE_SERVICE_ROLE_KEY (see lib/supabase.ts, lib/rag.ts,
-- app/api/upload/route.ts).
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
