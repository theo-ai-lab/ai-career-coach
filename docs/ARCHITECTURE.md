# AI Career Coach - System Architecture

**Version:** 1.0  
**Last Updated:** December 2024  
**Status:** Production-Ready MVP

---

## Overview

AI Career Coach is a RAG-powered career coaching application that provides personalized guidance based on the user's actual resume. The system uses vector search, multi-agent orchestration, persistent memory, and continuous evaluation to deliver high-quality, grounded career advice.

**Key Architectural Principles:**
- **Resume-Grounded:** All responses based on retrieved resume chunks
- **Non-Blocking:** Memory and evaluation don't delay responses
- **Graceful Degradation:** System works even if non-critical features fail
- **Single Data Layer:** Supabase for vectors + relational data
- **Cost-Conscious:** Efficient models (gpt-4o-mini, text-embedding-3-small)

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│  Next.js Frontend (React 19 + Tailwind CSS + shadcn/ui)             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ Chat UI     │  │ File Upload │  │ Agent Buttons│                 │
│  │             │  │             │  │             │                 │
│  │ - Messages  │  │ - PDF input │  │ - Cover Ltr │                 │
│  │ - Session   │  │ - Progress  │  │ - Interview │                 │
│  │ - Memory    │  │             │  │ - Strategy  │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Admin Dashboard (/admin/evals)                                │   │
│  │ - Evaluation metrics                                           │   │
│  │ - Quality scores                                               │   │
│  │ - Response analysis                                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           API LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│  Next.js API Routes (Serverless Functions)                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Core Routes                                                   │   │
│  │ POST /api/upload    - PDF parsing, chunking, embedding        │   │
│  │ POST /api/query     - RAG retrieval + generation + memory     │   │
│  │ POST /api/ingest    - Alternative ingestion (legacy)          │   │
│  │ POST /api/analyze   - Full agent graph (legacy)               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Agent Routes (7 specialized agents)                           │   │
│  │ POST /api/agents/resume        - Resume analysis             │   │
│  │ POST /api/agents/gap           - Gap identification          │   │
│  │ POST /api/agents/job-matcher   - Job matching                 │   │
│  │ POST /api/agents/cover-letter  - Cover letter generation     │   │
│  │ POST /api/agents/interview-prep - Interview Q&A prep         │   │
│  │ POST /api/agents/strategy      - 6-month plan                │   │
│  │ POST /api/agents/report        - Full report compilation     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Evaluation & Admin Routes                                     │   │
│  │ POST /api/evals/coaching-quality - Evaluate response        │   │
│  │ GET  /api/admin/evals            - Fetch evaluation stats    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        INTELLIGENCE LAYER                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │ RAG Engine      │  │ Memory System   │  │ Eval Framework  │      │
│  │                 │  │                 │  │                 │      │
│  │ lib/rag.ts      │  │ lib/memory/     │  │ lib/evals/      │      │
│  │                 │  │                 │  │                 │      │
│  │ - Chunking      │  │ - Semantic      │  │ - LLM-as-judge  │      │
│  │ - Embedding     │  │   (profiles)    │  │ - 4 dimensions  │      │
│  │ - Retrieval     │  │ - Episodic      │  │ - Scoring       │      │
│  │ - Filtering     │  │   (sessions)   │  │ - Storage        │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Agent Library (lib/agents/)                                  │   │
│  │ - resume-analyzer/  - gap-finder/  - job-matcher/            │   │
│  │ - cover-letter/    - interview-prep/ - strategy-advisor/     │   │
│  │ - report-generator/ - synthesizer/                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Supabase (PostgreSQL + pgvector extension)                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │ documents       │  │ user_profiles   │  │ session_memories│      │
│  │                 │  │                 │  │                 │      │
│  │ - Vectors       │  │ - Semantic mem  │  │ - Episodic mem  │      │
│  │ - Metadata      │  │ - Preferences   │  │ - Summaries      │      │
│  │ - RLS enabled   │  │ - Goals         │  │ - Decisions     │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│  ┌─────────────────┐                                                 │
│  │ evals           │                                                 │
│  │                 │                                                 │
│  │ - Quality scores│                                                 │
│  │ - Reasoning     │                                                 │
│  │ - Contexts      │                                                 │
│  └─────────────────┘                                                 │
│                                                                       │
│  RPC Functions:                                                      │
│  - match_documents(query_embedding, match_count)                    │
│    → Vector similarity search using cosine distance                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       EXTERNAL SERVICES                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐                           │
│  │ OpenAI API      │  │ PostHog         │                           │
│  │                 │  │                 │                           │
│  │ - Embeddings    │  │ - Analytics     │                           │
│  │   (text-embed-  │  │ - Events        │                           │
│  │    3-small)     │  │ - User tracking │                           │
│  │                 │  │                 │                           │
│  │ - Generation    │  │                 │                           │
│  │   (gpt-4o-mini) │  │                 │                           │
│  └─────────────────┘  └─────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Resume Upload Flow

```
User uploads PDF
       │
       ▼
POST /api/upload
       │
       ├──► pdf-parse extracts text from PDF buffer
       │
       ├──► RecursiveCharacterTextSplitter
       │    - chunkSize: 1000 tokens
       │    - chunkOverlap: 200 tokens
       │
       ├──► OpenAI text-embedding-3-small
       │    - Model: text-embedding-3-small
       │    - Dimensions: 1536
       │    - Batch embedding for all chunks
       │
       ├──► Generate unique resumeId (UUID)
       │
       └──► Supabase documents table insert
            - content: chunk text
            - embedding: vector(1536)
            - metadata: { source, user_id, resume_id }
            - Returns: { success, resumeId, chunks: count }
```

**Key Implementation Details:**
- Uses `SUPABASE_SERVICE_ROLE_KEY` for admin access
- Stores `resume_id` in metadata for filtering
- Returns `resumeId` to frontend for session tracking
- Error handling: Returns 400 if parsing fails, 500 for DB errors

**Code:** `app/api/upload/route.ts`

---

### 2. Query Flow (RAG + Memory)

```
User asks question
       │
       ▼
POST /api/query
       │
       ├──► Extract: { query, resumeId, sessionId, messages }
       │
       ├──► Memory Retrieval (non-blocking)
       │    ├──► getUserProfile(userId) → user_profiles
       │    └──► getRecentSessions(userId, 3) → session_memories
       │    └──► Format context string
       │    └──► Graceful degradation if fails
       │
       ├──► Embed query
       │    └──► OpenAI text-embedding-3-small
       │
       ├──► Vector Search
       │    └──► supabase.rpc('match_documents', {
       │           query_embedding: vector,
       │           match_count: resumeId ? 20 : 6
       │         })
       │    └──► Filter by resume_id in metadata
       │    └──► Slice to top 6 chunks
       │
       ├──► Build Grounded Prompt
       │    ├──► Resume context (retrieved chunks)
       │    ├──► Memory context (if available)
       │    ├──► Communication style adaptation
       │    └──► Natural memory reference instructions
       │
       ├──► Generate Response
       │    └──► GPT-4o-mini (temperature: 0.2)
       │    └──► Model: gpt-4o-mini
       │
       ├──► Fire-and-Forget Operations
       │    ├──► summarizeSessionAsync() - Background session summary
       │    └──► Evaluation (if enabled) - Background quality scoring
       │
       └──► Return Response
            - answer: string
            - sources: [{ content, similarity }]
            - sessionId: string
```

**Key Implementation Details:**
- Memory retrieval wrapped in try-catch (non-blocking)
- Returns empty context if memory fails
- Session summarization runs asynchronously (zero latency impact)
- Top-K retrieval: 6 chunks (configurable)
- Filtering by `resume_id` ensures user isolation

**Code:** `app/api/query/route.ts`, `lib/memory/retrieval.ts`

---

### 3. Agent Flow (Example: Cover Letter)

```
User clicks "Generate Cover Letter"
       │
       ▼
POST /api/agents/cover-letter
       │
       ├──► Extract: { resumeAnalysis, gapAnalysis, company }
       │
       ├──► Call Agent Function
       │    └──► writeCoverLetter(resumeAnalysis, gapAnalysis, company)
       │    └──► lib/agents/cover-letter/node.ts
       │
       ├──► Agent Processing
       │    ├──► Retrieve resume chunks (if needed)
       │    ├──► Build specialized prompt
       │    ├──► Generate with GPT-4o-mini
       │    └──► Parse and validate output
       │
       └──► Return Response
            - success: boolean
            - letter: { letter: string }
```

**Report Agent (Complex Flow):**
```
POST /api/agents/report
       │
       ├──► Step 1: Resume Analysis (with eval)
       ├──► Step 2: Job Matching (optional, if job description provided)
       ├──► Step 3: Gap Analysis (with eval)
       ├──► Step 4: Cover Letter (with eval)
       ├──► Step 5: Interview Prep (with eval)
       ├──► Step 6: Strategy Plan (with eval)
       └──► Step 7: Compile markdown report with quality scores
```

**Key Implementation Details:**
- Sequential generation (dependencies between steps)
- Each section evaluated independently
- Quality scores included in final report
- Error handling at each step

**Code:** `app/api/agents/*/route.ts`, `lib/agents/*/node.ts`

---

### 4. Memory System Flow

```
Session Start
       │
       ├──► User uploads resume → resumeId generated
       │
       ├──► First Query
       │    ├──► getMemoryContext(resumeId)
       │    │    ├──► getUserProfile(resumeId) → null (first time)
       │    │    └──► getRecentSessions(resumeId, 3) → []
       │    └──► Response generated without memory context
       │
       ├──► After Response (fire-and-forget)
       │    └──► summarizeSessionAsync(resumeId, sessionId, messages)
       │         ├──► GPT-4o-mini analyzes conversation
       │         ├──► Extracts: summary, decisions, topics, actions, sentiment
       │         └──► Insert into session_memories table
       │
       └──► Next Query
            ├──► getMemoryContext(resumeId)
            │    ├──► getUserProfile(resumeId) → profile (if exists)
            │    └──► getRecentSessions(resumeId, 3) → [session1, session2, ...]
            └──► Response includes memory context
                 └──► "Based on our last conversation..."
```

**Memory Layers:**
1. **Semantic Memory** (`user_profiles`): Goals, preferences, target companies
2. **Episodic Memory** (`session_memories`): Conversation summaries, decisions, action items
3. **Procedural Memory** (planned): Learned preferences from user reactions

**Code:** `lib/memory/semantic.ts`, `lib/memory/episodic.ts`, `lib/memory/retrieval.ts`

---

### 5. Evaluation Flow

```
Response Generated
       │
       ├──► Synchronous (if in report agent)
       │    └──► evaluateResponse(sectionName, query, response, contexts)
       │         ├──► evaluateCoachingQuality({ query, response, contexts })
       │         ├──► LLM-as-judge (GPT-4o-mini)
       │         ├──► Scores: actionability, personalization, honesty, grounding
       │         ├──► Overall score (0-100)
       │         └──► Store in evals table (non-blocking)
       │
       └──► Asynchronous (background)
            └──► Doesn't block user response
            └──► Logs failures for monitoring
```

**Evaluation Dimensions:**
- **Actionability (1-5):** Can user act within 48 hours?
- **Personalization (1-5):** Specific to their resume?
- **Honesty (1-5):** Acknowledges uncertainty?
- **Grounding (1-5):** Traceable to retrieved context?

**Code:** `lib/evals/coaching-quality.ts`, `app/api/evals/coaching-quality/route.ts`

---

## Database Schema

### documents (Vector Storage)

**Purpose:** Store resume chunks with embeddings for RAG retrieval

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Primary key |
| `content` | TEXT | Chunk text content |
| `embedding` | vector(1536) | OpenAI embedding vector |
| `metadata` | JSONB | `{ source, user_id, resume_id }` |
| `created_at` | TIMESTAMPTZ | Timestamp |

**Indexes:**
- Vector index: `ivfflat (embedding vector_cosine_ops)` for similarity search
- Metadata index: On `metadata->>'resume_id'` for filtering

**RLS Policies:**
- Allow anon insert/select (for API routes)

**RPC Function:**
- `match_documents(query_embedding vector, match_count int)` → Returns top-K similar documents with similarity scores

---

### user_profiles (Semantic Memory)

**Purpose:** Store user profile data for personalization

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (default: uuid_generate_v4()) |
| `user_id` | TEXT | Unique user identifier (resumeId) |
| `name` | TEXT | User's name |
| `current_role` | TEXT | Current job title |
| `target_role` | TEXT | Desired role |
| `target_companies` | JSONB | Array of target companies |
| `skills` | JSONB | Array of skills |
| `career_goals` | TEXT | Long-term career goals |
| `communication_style` | TEXT | 'direct' \| 'encouraging' \| 'balanced' |
| `detail_preference` | TEXT | 'brief' \| 'moderate' \| 'detailed' |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**Indexes:**
- `idx_user_profiles_user_id` on `user_id` (unique constraint)

**RLS Policies:**
- Allow all operations (permissive for development)

---

### session_memories (Episodic Memory)

**Purpose:** Store conversation summaries for continuity

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (default: uuid_generate_v4()) |
| `user_id` | TEXT | User identifier (resumeId) |
| `session_id` | TEXT | Unique session identifier |
| `summary` | TEXT | 2-sentence conversation summary |
| `key_decisions` | JSONB | Array of decisions made |
| `topics_discussed` | JSONB | Array of topics covered |
| `action_items` | JSONB | Array of user action items |
| `sentiment` | TEXT | 'positive' \| 'neutral' \| 'frustrated' \| 'anxious' |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Indexes:**
- `idx_session_memories_user_id` on `user_id`
- `idx_session_memories_created` on `created_at DESC`

**RLS Policies:**
- Allow all operations (permissive for development)

---

### evals (Quality Tracking)

**Purpose:** Store evaluation scores for quality monitoring

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (default: uuid_generate_v4()) |
| `response_id` | TEXT | Identifier linking to response |
| `query` | TEXT | User's query |
| `response` | TEXT | AI's response |
| `contexts` | JSONB | Array of retrieved context chunks |
| `scores` | JSONB | `{ actionability, personalization, honesty, grounding }` |
| `reasoning` | TEXT | Evaluator's reasoning |
| `overall_score` | FLOAT | Average score (0-100) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Indexes:**
- `idx_evals_created_at` on `created_at DESC`
- `idx_evals_overall_score` on `overall_score`

**RLS Policies:**
- Allow anon insert/select (for API routes)

---

## Tech Stack

| Layer | Technology | Version/Purpose |
|-------|------------|-----------------|
| **Frontend Framework** | Next.js | 16.0.3 |
| **UI Library** | React | 19.2.0 |
| **Styling** | Tailwind CSS | 4.x |
| **Components** | shadcn/ui | Radix UI primitives |
| **API Layer** | Next.js API Routes | Serverless functions |
| **Database** | Supabase | PostgreSQL + pgvector |
| **Vector Extension** | pgvector | Vector similarity search |
| **Embedding Model** | OpenAI | text-embedding-3-small (1536 dim) |
| **LLM** | OpenAI | GPT-4o-mini (temperature: 0.2) |
| **PDF Parsing** | pdf-parse | 1.1.4 |
| **Text Splitting** | LangChain | RecursiveCharacterTextSplitter |
| **Orchestration** | LangGraph | 1.0.2 (for multi-agent) |
| **Analytics** | PostHog | 1.297.2 (optional) |
| **Deployment** | Vercel | (planned) |

---

## Security Considerations

### User Isolation
- **Resume Filtering:** All queries filter by `resume_id` in metadata
- **User Scoping:** `user_id` used for memory retrieval
- **RLS Policies:** Row Level Security enabled on all tables
- **No Cross-User Access:** Queries explicitly filter by user/resume ID

### API Security
- **Environment Variables:** API keys stored in `.env.local`, never exposed to client
- **Service Role Key:** Used only server-side for admin operations
- **Input Validation:** PDF parsing with error handling, file size limits
- **Error Handling:** Graceful degradation, no sensitive data in error messages

### Data Privacy
- **No PII in Logs:** User data not logged in production
- **Retention Policy:** (TBD) - Need to define memory retention periods
- **Data Export:** (Planned) - User data export functionality

---

## Performance Characteristics

| Metric | Target | Current | Notes |
|--------|--------|---------|-------|
| **Upload latency** | <5s | ~2-3s | PDF parsing + chunking + embedding |
| **Query latency** | <5s | ~3-5s | Embedding + retrieval + generation |
| **Agent generation** | <15s | ~5-10s | Varies by agent complexity |
| **Report generation** | <60s | ~30-45s | Sequential generation of 5-6 sections |
| **Memory retrieval** | <500ms | ~200ms | Non-blocking, doesn't affect latency |
| **Session summarization** | N/A | Background | Fire-and-forget, zero user impact |
| **Vector search** | <200ms | ~100-150ms | pgvector with ivfflat index |

**Optimization Strategies:**
- Non-blocking operations (memory, evaluation, summarization)
- Efficient model selection (gpt-4o-mini, text-embedding-3-small)
- Top-K retrieval limits (6-12 chunks)
- Batch embedding generation
- Lazy initialization of clients

---

## Error Handling Strategy

### Graceful Degradation
- **Memory failures:** Return empty context, continue without memory
- **Evaluation failures:** Continue without scores, log for monitoring
- **Session summarization failures:** Log error, don't block response
- **Vector search failures:** Return "No relevant experience found"

### Error Types
1. **User Errors:** 400 Bad Request (missing fields, invalid input)
2. **System Errors:** 500 Internal Server Error (DB failures, API errors)
3. **Not Found:** 404 (missing resume, no documents)

### Logging
- Console warnings for non-critical failures
- Error logging for system failures
- Monitoring alerts for high failure rates

---

## Scalability Considerations

### Current Scale
- **Users:** Single-user MVP
- **Documents:** <10k chunks per user
- **Queries:** Low volume (<100/day)

### Scaling Strategies
1. **Database:**
   - Supabase free tier → paid tier for more storage
   - Connection pooling for high concurrency
   - Index optimization for vector search

2. **API:**
   - Next.js serverless functions auto-scale
   - Rate limiting (planned)
   - Caching for common queries (planned)

3. **Memory System:**
   - Sharding by user_id (if needed)
   - Archival of old session memories
   - Caching frequently accessed profiles

4. **Cost Optimization:**
   - Embedding caching (planned)
   - Batch processing for bulk operations
   - Model selection (already optimized)

---

## Future Architecture Considerations

### Short-term (Q1 2025)
- **LangGraph Integration:** Complex multi-agent orchestration with state management
- **Streaming Responses:** Real-time response streaming for better UX
- **Caching Layer:** Redis for frequently accessed data
- **Rate Limiting:** Protect against abuse

### Medium-term (Q2 2025)
- **Voice Interface:** WebRTC for interview practice
- **Multi-Resume Support:** Version management for multiple resume iterations
- **Advanced RAG:** Hybrid search (vector + keyword), reranking
- **A/B Testing:** Framework for prompt and model experimentation

### Long-term (Q3-Q4 2025)
- **Microservices:** Split agents into separate services
- **Event-Driven Architecture:** Kafka/PubSub for async processing
- **Multi-Region:** Global deployment for low latency
- **Edge Functions:** Vercel Edge Functions for faster responses

---

## Monitoring & Observability

### Current Monitoring
- **Console Logging:** Development logging for debugging
- **Error Tracking:** (Planned) Sentry integration
- **Analytics:** PostHog for user behavior (optional)

### Planned Monitoring
- **Performance Metrics:** Response latency, throughput
- **Quality Metrics:** Evaluation scores, hallucination rate
- **System Health:** Database connection, API availability
- **Cost Tracking:** OpenAI API usage, Supabase usage

### Alerting (Planned)
- **Critical:** Hallucination reports, security breaches
- **High:** Low evaluation scores, high error rates
- **Medium:** Performance degradation, memory failures
- **Low:** Non-critical feature failures

---

## Deployment Architecture

### Current
- **Development:** Local Next.js dev server
- **Production:** (Planned) Vercel deployment

### Production Setup (Planned)
```
GitHub Repository
       │
       ▼
Vercel (Auto-deploy on push)
       │
       ├──► Environment Variables
       │    - NEXT_PUBLIC_SUPABASE_URL
       │    - SUPABASE_SERVICE_ROLE_KEY
       │    - OPENAI_API_KEY
       │
       └──► Serverless Functions
            - API routes as serverless functions
            - Auto-scaling based on traffic
```

---

## Code Organization

```
ai-career-coach/
├── app/
│   ├── api/              # API routes
│   │   ├── agents/       # Agent endpoints
│   │   ├── admin/        # Admin endpoints
│   │   └── evals/        # Evaluation endpoints
│   ├── admin/            # Admin pages
│   └── page.tsx          # Main chat interface
├── lib/
│   ├── agents/           # Agent implementations
│   │   ├── resume-analyzer/
│   │   ├── gap-finder/
│   │   ├── job-matcher/
│   │   ├── cover-letter/
│   │   ├── interview-prep/
│   │   ├── strategy-advisor/
│   │   └── report-generator/
│   ├── memory/           # Memory system
│   │   ├── semantic.ts
│   │   ├── episodic.ts
│   │   └── retrieval.ts
│   ├── evals/            # Evaluation framework
│   ├── rag.ts            # RAG utilities
│   └── supabase.ts       # Supabase client
├── components/           # UI components
├── docs/                 # Documentation
└── supabase-*.sql       # Database schemas
```

---

## API Contracts

### Request/Response Patterns

**Upload:**
```typescript
POST /api/upload
Body: FormData { file: File, userId: string }
Response: { success: boolean, resumeId: string, chunks: number }
```

**Query:**
```typescript
POST /api/query
Body: { query: string, resumeId?: string, sessionId?: string, messages?: Array }
Response: { answer: string, sources: Array, sessionId: string }
```

**Agent (Example - Cover Letter):**
```typescript
POST /api/agents/cover-letter
Body: { resumeAnalysis: object, gapAnalysis: object, company: string }
Response: { success: boolean, letter: { letter: string } }
```

**Report:**
```typescript
POST /api/agents/report
Body: { resumeId: string, targetCompany?: string, targetRole?: string, jobDescription?: string }
Response: Markdown string (text/markdown)
```

---

## Dependencies & External Services

### Critical Dependencies
- **Supabase:** Vector database, user data storage
- **OpenAI API:** Embeddings and LLM generation

### Optional Dependencies
- **PostHog:** Analytics (app works without it)

### Service Availability
- **Supabase:** 99.9% uptime SLA
- **OpenAI API:** 99.9% uptime SLA
- **Graceful Degradation:** System handles service outages

---

*Last updated: December 2024*  
*Next review: January 2025*

