-- Enable UUID extension (required for uuid_generate_v4)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Profiles (Semantic Memory)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT UNIQUE NOT NULL,
  name TEXT,
  current_role TEXT,
  target_role TEXT,
  target_companies JSONB DEFAULT '[]',
  skills JSONB DEFAULT '[]',
  career_goals TEXT,
  communication_style TEXT DEFAULT 'balanced',
  detail_preference TEXT DEFAULT 'moderate',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session Memories (Episodic Memory)
CREATE TABLE IF NOT EXISTS session_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_decisions JSONB DEFAULT '[]',
  topics_discussed JSONB DEFAULT '[]',
  action_items JSONB DEFAULT '[]',
  sentiment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_session_memories_user_id ON session_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_session_memories_created ON session_memories(created_at DESC);

-- RLS: memory tables hold per-user profile and conversation data and are
-- written/read exclusively through the service-role key (lib/memory/*.ts).
-- Pre-ship audit Defer-6: the previous "Allow all operations ... USING (true)"
-- policies let any anon-key holder (i.e. anyone viewing the deployed site)
-- read, write, or delete any user's profile and session memories. Restricted
-- to service_role only, mirroring the evals-table pattern in 04-supabase-evals.sql.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_memories ENABLE ROW LEVEL SECURITY;

-- Drop the old permissive policies and the new ones (idempotent re-run).
DROP POLICY IF EXISTS "Allow all operations on user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow all operations on session_memories" ON session_memories;
DROP POLICY IF EXISTS "service role all user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "service role all session_memories" ON session_memories;

-- service_role-only access covering SELECT / INSERT / UPDATE / DELETE. With RLS
-- enabled and no anon or authenticated policy present, those roles are denied
-- by default — the table is reachable only via the service-role key server-side.
CREATE POLICY "service role all user_profiles" ON user_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service role all session_memories" ON session_memories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
