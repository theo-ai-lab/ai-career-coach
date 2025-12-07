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

-- RLS Policies (permissive for development)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_memories ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (prevents duplicate errors)
DROP POLICY IF EXISTS "Allow all operations on user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow all operations on session_memories" ON session_memories;

-- Create permissive policies
CREATE POLICY "Allow all operations on user_profiles" ON user_profiles FOR ALL USING (true);
CREATE POLICY "Allow all operations on session_memories" ON session_memories FOR ALL USING (true);
