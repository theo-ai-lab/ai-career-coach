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

-- Row-Level Security: enable now, refined policies live in 05-supabase-fix.sql.
-- Standalone-safe default: anon insert + select. 05-supabase-fix.sql replaces these with the canonical set.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow anon insert" ON documents
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "allow anon select" ON documents
  FOR SELECT TO anon USING (true);
