# Project Audit Report

Generated: 2025-01-27

## 1. API Routes in /app/api/

| Route Path | HTTP Methods | Description | Dependencies |
|------------|--------------|-------------|--------------|
| `/api/admin/evals` | GET | Fetches last 50 evaluation records and calculates average scores for coaching quality metrics | `@/lib/supabase` |
| `/api/agents/cover-letter` | POST | Generates a tailored cover letter based on resume analysis and gap analysis | `@/lib/agents/cover-letter/node` |
| `/api/agents/gap` | POST | Analyzes gaps between resume and job description | `@/lib/agents/gap-finder/node`, `@/lib/agents/resume-analyzer/schema` |
| `/api/agents/interview-prep` | POST | Generates interview preparation questions and answers (behavioral, product, technical) | `@/lib/agents/interview-prep/node` |
| `/api/agents/job-matcher` | POST | Matches resume against job description and returns match score, gaps, and talking points | `@/lib/rag`, `@/lib/agents/job-matcher/schema` |
| `/api/agents/report` | POST | Generates comprehensive career report with resume analysis, gap analysis, cover letter, interview prep, and strategy plan | `@/lib/rag`, `@/lib/evals/coaching-quality`, `@/lib/supabase` |
| `/api/agents/resume` | POST | Analyzes resume text and extracts structured information | `@/lib/agents/resume-analyzer/node` |
| `/api/agents/strategy` | POST | Generates 6-month strategy plan to land target role | `@/lib/agents/strategy-advisor/node` |
| `/api/analyze` | POST | Runs the full career agent graph pipeline (legacy/alternative entry point) | `@/lib/agents` |
| `/api/evals/coaching-quality` | POST | Evaluates coaching response quality and stores results in Supabase | `@/lib/evals/coaching-quality`, `@/lib/supabase` |
| `/api/ingest` | POST | Ingests PDF documents, splits into chunks, and stores in Supabase documents table | `@supabase/supabase-js`, `@langchain/textsplitters`, `@langchain/community/document_loaders/fs/pdf` |
| `/api/query` | POST | Performs RAG query: embeds user query, finds similar documents, generates grounded response | `@supabase/supabase-js`, `@langchain/openai` |
| `/api/upload` | POST | Uploads PDF resume, extracts text, chunks it, generates embeddings, and stores in Supabase with resume_id | `@supabase/supabase-js`, `@langchain/textsplitters`, `@langchain/openai`, `pdf-parse` |

## 2. Pages in /app/

| Route Path | What It Renders |
|------------|-----------------|
| `/` (app/page.tsx) | Main chat interface with resume upload, query input, and buttons to generate cover letter, interview prep, strategy plan, and full career report |
| `/admin/evals` (app/admin/evals/page.tsx) | Admin dashboard displaying coaching quality evaluation scores, statistics, and detailed eval records |

## 3. /lib/ Folder Modules

| Module | Exports | Usage Status |
|--------|---------|--------------|
| `lib/utils.ts` | `cn()` - Tailwind class name merger | ✅ Used in UI components (button, input, scroll-area, card) |
| `lib/supabase.ts` | `getSupabase()` - Returns Supabase client instance | ✅ Used in: admin/evals route, agents/report route, evals/coaching-quality route, agents/resume-analyzer/node |
| `lib/rag.ts` | `getResumeContextById()`, `getChatClient()` | ✅ Used in: agents/job-matcher route, agents/report route, evals/coaching-quality |
| `lib/agents.ts` | `careerAgent` - LangGraph career agent | ✅ Used in: api/analyze route |
| `lib/graph.ts` | `graph` - StateGraph instance | ⚠️ Exported but not directly imported anywhere (may be used via agents.ts) |
| `lib/evals/coaching-quality.ts` | `evaluateCoachingQuality()`, `CoachingQualityInput` | ✅ Used in: api/evals/coaching-quality route, api/agents/report route |
| `lib/agents/cover-letter/node.ts` | `writeCoverLetter()` | ✅ Used in: api/agents/cover-letter route, lib/graph.ts |
| `lib/agents/cover-letter/schema.ts` | Type definitions | ✅ Used in: lib/agents/synthesizer/node.ts |
| `lib/agents/gap-finder/node.ts` | `findGaps()` | ✅ Used in: api/agents/gap route, lib/graph.ts |
| `lib/agents/gap-finder/schema.ts` | `GapAnalysis` type | ✅ Used in: lib/agents/cover-letter/node.ts, lib/agents/synthesizer/node.ts |
| `lib/agents/interview-prep/node.ts` | `generateInterviewPrep()` | ✅ Used in: api/agents/interview-prep route, lib/graph.ts |
| `lib/agents/interview-prep/schema.ts` | `InterviewPrep` type | ✅ Used in: lib/agents/synthesizer/node.ts |
| `lib/agents/job-matcher/schema.ts` | `JobMatch` type | ✅ Used in: api/agents/job-matcher route |
| `lib/agents/report-generator/node.ts` | `synthesizeCareerReport()` | ⚠️ Exported but not directly imported (may be unused) |
| `lib/agents/resume-analyzer/node.ts` | `analyzeResume()` | ✅ Used in: api/agents/resume route, lib/graph.ts |
| `lib/agents/resume-analyzer/schema.ts` | `ResumeAnalysis`, `ResumeAnalysisSchema` | ✅ Used in: api/agents/gap route, lib/agents/cover-letter/node.ts, lib/agents/synthesizer/node.ts |
| `lib/agents/strategy-advisor/node.ts` | `generateStrategy()` | ✅ Used in: api/agents/strategy route, lib/graph.ts |
| `lib/agents/strategy-advisor/schema.ts` | `StrategyPlan` type | ✅ Used in: lib/agents/synthesizer/node.ts |
| `lib/agents/synthesizer/node.ts` | `synthesizeCareerReport()` | ✅ Used in: lib/agents/report-generator/node.ts |

**Unused Exports:**
- `lib/graph.ts` - `graph` export appears unused (may be legacy)
- `lib/agents/report-generator/node.ts` - `synthesizeCareerReport()` may be unused (report route uses direct LLM calls)

## 4. Supabase Tables & RPC Functions

### Tables Referenced:

| Table Name | Usage | Schema (from code/SQL) |
|------------|-------|------------------------|
| `documents` | Stores resume chunks with embeddings for RAG | `id` (BIGSERIAL), `content` (TEXT), `metadata` (JSONB), `embedding` (vector(1536)) |
| `evals` | Stores coaching quality evaluation results | `id` (UUID), `response_id` (TEXT), `query` (TEXT), `response` (TEXT), `contexts` (JSONB), `scores` (JSONB), `reasoning` (TEXT), `overall_score` (FLOAT), `created_at` (TIMESTAMPTZ) |

### RPC Functions Referenced:

| RPC Function | Usage | Parameters |
|--------------|-------|------------|
| `match_documents` | Vector similarity search for RAG retrieval | `query_embedding` (vector), `match_count` (int) |

**Note:** The `match_documents` RPC function is referenced but not defined in the codebase SQL files. It's likely a standard Supabase pgvector function that needs to be created in the database.

## 5. Environment Variables

### Required Environment Variables:

| Variable Name | Used In | Purpose |
|---------------|---------|---------|
| `SUPABASE_URL` | `lib/supabase.ts`, `lib/agents.ts`, `scripts/ingest.ts` | Supabase project URL (server-side) |
| `SUPABASE_ANON_KEY` | `lib/supabase.ts`, `lib/agents.ts`, `scripts/ingest.ts` | Supabase anonymous key (server-side) |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/rag.ts`, `app/api/query/route.ts`, `app/api/upload/route.ts`, `app/api/ingest/route.ts` | Supabase project URL (client-side accessible) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/rag.ts`, `app/api/query/route.ts`, `app/api/ingest/route.ts` | Supabase anonymous key (client-side accessible) |
| `SUPABASE_SERVICE_ROLE_KEY` | `app/api/upload/route.ts` | Supabase service role key for admin operations |
| `OPENAI_API_KEY` | `lib/rag.ts`, `lib/agents.ts`, `app/api/upload/route.ts` | OpenAI API key for embeddings and chat |

### Optional Environment Variables:

| Variable Name | Used In | Purpose |
|---------------|---------|---------|
| `NEXT_PUBLIC_POSTHOG_KEY` | `app/providers.tsx` | PostHog analytics key |
| `NEXT_PUBLIC_POSTHOG_HOST` | `app/providers.tsx` | PostHog host URL |
| `NODE_ENV` | `app/api/analyze/route.ts` | Node environment (development/production) |

### Missing from .env.local Check:

⚠️ **Cannot verify** - `.env.local` file is filtered by globalignore and not accessible. Please manually verify all required variables are set.

**Expected .env.local contents:**
```env
# Required
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_api_key

# Optional
NEXT_PUBLIC_POSTHOG_KEY=your_posthog_key
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

## 6. Git Status

### Current Branch:
`feature/evals-and-memory`

### Modified but Uncommitted Files:

| File | Status |
|------|--------|
| `app/api/agents/gap/route.ts` | Modified |
| `app/api/agents/interview-prep/route.ts` | Modified |
| `app/api/agents/strategy/route.ts` | Modified |
| `app/api/query/route.ts` | Modified |
| `app/layout.tsx` | Modified |
| `app/page.tsx` | Modified |
| `lib/agents/gap-finder/node.ts` | Modified |
| `lib/agents/interview-prep/node.ts` | Modified |
| `lib/agents/strategy-advisor/node.ts` | Modified |
| `lib/graph.ts` | Modified |
| `package-lock.json` | Modified |

### Untracked Files:

| File | Status |
|------|--------|
| `PROJECT_AUDIT.md` | Untracked (this file) |

---

## Summary

- **Total API Routes:** 13
- **Total Pages:** 2
- **Lib Modules:** 19 files across agents, evals, and utilities
- **Supabase Tables:** 2 (documents, evals)
- **Supabase RPC Functions:** 1 (match_documents - needs verification in DB)
- **Required Env Vars:** 6
- **Optional Env Vars:** 3
- **Modified Files:** 11
- **Untracked Files:** 1
