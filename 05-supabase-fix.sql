-- Fix RLS policies to allow anon access (for server-side API routes)
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "allow insert" ON documents;
DROP POLICY IF EXISTS "allow own select" ON documents;

-- Create policies that allow anon role (for API routes using anon key)
CREATE POLICY "allow anon insert" ON documents 
  FOR INSERT 
  TO anon 
  WITH CHECK (true);

CREATE POLICY "allow anon select" ON documents 
  FOR SELECT 
  TO anon 
  USING (true);

-- Also keep authenticated policies if you want user-specific access later
CREATE POLICY "allow authenticated insert" ON documents 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

-- Authenticated reads scope to the user's own rows. The previous
-- version of this clause contained "OR true" which short-circuited the
-- user-id filter and made RLS a no-op for authenticated reads
-- (pre-ship audit 2026-05-12, L2-069). Until real auth lands, this
-- policy is dormant (no callers run as `authenticated`), so removing
-- "OR true" is non-breaking.
CREATE POLICY "allow authenticated select" ON documents
  FOR SELECT
  TO authenticated
  USING (metadata->>'userId' = auth.uid()::text);

