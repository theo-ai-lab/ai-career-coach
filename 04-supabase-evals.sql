-- evals table depends on uuid_generate_v4() from the uuid-ossp extension.
-- Idempotent; safe if 03-supabase-memory.sql already enabled it.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create evals table for storing coaching quality evaluations
CREATE TABLE IF NOT EXISTS evals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  response_id TEXT,
  query TEXT,
  response TEXT,
  contexts JSONB,
  scores JSONB,
  reasoning TEXT,
  overall_score FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_evals_created_at ON evals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evals_overall_score ON evals(overall_score);

-- Anon role can INSERT eval rows (API routes use the anon key to write).
-- Anon role can NOT read evals — eval data is operational telemetry and
-- should be queryable only by service_role (server-side access using the
-- service-role key).
-- Security hardening 2026-05-12: previously anon could SELECT all
-- eval rows, which exposed every response_id, query, and response across
-- all users to anyone holding the anon key.
DROP POLICY IF EXISTS "allow anon insert" ON evals;
DROP POLICY IF EXISTS "allow anon select" ON evals;
DROP POLICY IF EXISTS "service role read evals" ON evals;

CREATE POLICY "allow anon insert" ON evals
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "service role read evals" ON evals
  FOR SELECT
  TO service_role
  USING (true);
