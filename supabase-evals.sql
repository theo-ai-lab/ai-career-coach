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

-- Allow anon access for API routes
DROP POLICY IF EXISTS "allow anon insert" ON evals;
DROP POLICY IF EXISTS "allow anon select" ON evals;

CREATE POLICY "allow anon insert" ON evals 
  FOR INSERT 
  TO anon 
  WITH CHECK (true);

CREATE POLICY "allow anon select" ON evals 
  FOR SELECT 
  TO anon 
  USING (true);

