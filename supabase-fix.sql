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

CREATE POLICY "allow authenticated select" ON documents 
  FOR SELECT 
  TO authenticated 
  USING (metadata->>'userId' = auth.uid()::text OR true);

