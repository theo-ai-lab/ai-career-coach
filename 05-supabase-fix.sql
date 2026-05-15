-- Canonical RLS for the documents table. Defer-2 closure (2026-05-14):
-- service_role-only access, mirroring the pattern in 03-supabase-memory.sql
-- and 04-supabase-evals.sql. With RLS enabled (01-supabase-documents.sql)
-- and no anon/authenticated SELECT or INSERT policy present, those roles
-- are denied by default — the table is reachable only via the service-role
-- key server-side. Every server caller is responsible for its own user_id /
-- resume_id scoping; service_role bypasses RLS so the function/RPC body is
-- the only filter.

-- Drop legacy and new policy names so this file is idempotent on re-run.
DROP POLICY IF EXISTS "allow insert" ON documents;
DROP POLICY IF EXISTS "allow own select" ON documents;
DROP POLICY IF EXISTS "allow anon insert" ON documents;
DROP POLICY IF EXISTS "allow anon select" ON documents;
DROP POLICY IF EXISTS "allow authenticated insert" ON documents;
DROP POLICY IF EXISTS "allow authenticated select" ON documents;
DROP POLICY IF EXISTS "service role all documents" ON documents;

CREATE POLICY "service role all documents" ON documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

