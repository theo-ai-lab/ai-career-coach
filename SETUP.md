# Setup Guide

## Prerequisites

1. **Supabase Account** - You need a Supabase project with pgvector enabled
2. **OpenAI API Key** - For embeddings and chat
3. **PostHog Account** (optional) - For analytics

## Step 1: Environment Variables

Make sure your `.env.local` file has these variables:

```env
# Required
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=your_openai_api_key

# Optional (for PostHog analytics)
NEXT_PUBLIC_POSTHOG_KEY=your_posthog_key
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

## Step 2: Set Up Supabase Database

In your Supabase project, run this SQL to create the documents table:

```sql
-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the documents table
CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  content TEXT,
  metadata JSONB,
  embedding vector(1536)
);

-- Create an index for vector similarity search
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

## Step 3: Ingest Your Resume

Run the ingest script to load your resume into Supabase:

```bash
npm run ingest
```

This will:
- Read `data/resume.txt`
- Split it into chunks
- Generate embeddings using OpenAI
- Store everything in your Supabase `documents` table

## Step 4: Start the Development Server

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Troubleshooting

- **"Internal Server Error"**: Check that all environment variables are set correctly
- **"Table not found"**: Make sure you've run the SQL setup in Step 2
- **"No results"**: Run `npm run ingest` to load your resume data
- **PostHog errors**: These are optional - the app will work without them

