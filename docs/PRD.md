# AI Career Coach - Product Requirements Document

**Version:** 1.3  
**Last Updated:** December 2024  
**Author:** Theo Bermudez  
**Status:** In Development (MVP Complete, Intelligence Layer In Progress)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Oct 2024 | Initial PRD - Core RAG system |
| 1.1 | Nov 2024 | Added multi-agent architecture |
| 1.2 | Nov 2024 | Added evaluation framework |
| 1.3 | Dec 2024 | Added memory system, HITL workflows |

---

## 1. Problem Statement

### Market Problem
- **Career coaching costs $200-500/hour** - Prohibitive for most job seekers
- **64% of adults would benefit but don't access it** (Conference Board research)
- **Existing AI tools give generic advice** - Not personalized to individual backgrounds
- **No context retention** - Users must re-explain their situation each session
- **Can't handle high-stakes decisions** - Generic advice risks poor career choices

### User Pain Points
1. **Resume analysis is manual and time-consuming** - Hard to identify gaps vs. target roles
2. **Cover letters feel generic** - Difficult to tailor without deep self-reflection
3. **Interview prep is overwhelming** - Don't know which questions to prepare for
4. **Career strategy lacks structure** - No clear roadmap to land dream roles
5. **No continuity between sessions** - Must re-establish context repeatedly

---

## 2. Target Users

### Primary: Job Seekers Targeting Competitive Roles
- **Demographics:** Tech professionals, recent graduates, career transitioners
- **Goals:** Land roles at top tech companies (OpenAI, Anthropic, Google, etc.)
- **Pain Points:** Need personalized, resume-grounded advice at scale
- **Tech Comfort:** High - comfortable with AI tools and digital interfaces

### Secondary: Career Transitioners
- **Demographics:** Professionals switching industries or roles
- **Goals:** Understand skill gaps and create transition plan
- **Pain Points:** Unclear on what skills/experiences to highlight
- **Tech Comfort:** Medium - need clear, guided experience

---

## 3. Solution Overview

**RAG-powered career coaching that uses the user's actual resume to provide personalized, grounded guidance across the job search journey.**

### Core Value Proposition
1. **Resume-Grounded Responses** - Every answer is based on YOUR actual experience (via RAG)
2. **Multi-Agent Specialization** - 7 specialized agents for different career tasks
3. **Memory System** - Remembers your goals, preferences, and past conversations
4. **Quality Assurance** - LLM-as-judge evaluation ensures high-quality, actionable advice
5. **Zero Hallucination** - Strict grounding rules prevent false claims about your background

### Key Differentiators
- **Not generic ChatGPT** - Uses YOUR resume, not generic templates
- **Persistent memory** - Remembers you across sessions
- **Specialized agents** - Each agent optimized for specific career tasks
- **Quality tracking** - Continuous evaluation and improvement
- **Production-ready RAG** - Real vector search, not demos

---

## 4. Core Capabilities

### 4.1 Resume Intelligence (RAG)

**Purpose:** Ground all responses in user's actual resume to prevent hallucination

**Technical Implementation:**
- **PDF Upload** → `pdf-parse` text extraction
- **Chunking Strategy:** 1000 tokens per chunk, 200 token overlap
- **Embedding Model:** OpenAI `text-embedding-3-small` (1536 dimensions)
- **Vector Storage:** Supabase pgvector with `documents` table
- **Retrieval:** `match_documents` RPC function for cosine similarity search
- **Top-K:** 6-12 chunks retrieved per query (configurable by resumeId)

**Key Features:**
- Resume chunks stored with `resume_id` metadata for filtering
- Vector similarity search finds most relevant experience sections
- Context injection ensures LLM only uses retrieved chunks
- Anti-hallucination prompts explicitly forbid inventing experience

**API Endpoints:**
- `POST /api/upload` - Upload PDF, chunk, embed, store
- `POST /api/query` - RAG query with memory integration
- `POST /api/ingest` - Alternative ingestion path (legacy)

---

### 4.2 Specialized Agents

**Architecture:** 7 independent agents, each optimized for specific career tasks

| Agent | Purpose | Inputs | Outputs | API Route |
|-------|---------|--------|---------|-----------|
| **Resume Analyzer** | Extract structured profile from resume | Resume chunks (RAG) | Summary, strengths, projects, skills | `/api/agents/resume` |
| **Gap Finder** | Compare resume to target role | Resume analysis + job description | Fit score, missing skills, gaps, recommendations | `/api/agents/gap` |
| **Job Matcher** | Match resume to specific job posting | Resume chunks + job description | Match score (0-100), strong matches, gaps, talking points | `/api/agents/job-matcher` |
| **Cover Letter Writer** | Generate tailored cover letters | Resume analysis + gap analysis + company | Professional cover letter (markdown) | `/api/agents/cover-letter` |
| **Interview Prep** | Generate Q&A preparation | Resume analysis + gap analysis + role | Behavioral, product, technical questions with answers | `/api/agents/interview-prep` |
| **Strategy Planner** | 6-month roadmap to land role | Resume analysis + gap analysis + company | Monthly breakdown with actions | `/api/agents/strategy` |
| **Report Compiler** | Full career report (all-in-one) | ResumeId + optional job description | Complete markdown report with all sections | `/api/agents/report` |

**Agent Characteristics:**
- **Temperature:** 0.2 (low for consistency)
- **Model:** GPT-4o-mini (cost-effective, high quality)
- **Grounding:** All agents use RAG-retrieved context
- **Evaluation:** Report agent includes quality scoring for each section

**Report Agent Pipeline:**
1. Resume Analysis (with eval)
2. Job Matching (optional, if job description provided)
3. Gap Analysis (with eval)
4. Cover Letter Generation (with eval)
5. Interview Prep (with eval)
6. Strategy Plan (with eval)
7. Compile markdown report with quality scores

---

### 4.3 Memory System

**Architecture:** Three-layer memory system inspired by LangMem patterns

#### Layer 1: Semantic Memory (User Profile)
**Storage:** `user_profiles` table in Supabase

**Fields:**
- `user_id` (TEXT, unique) - Primary identifier
- `name`, `current_role`, `target_role` - Basic info
- `target_companies` (JSONB) - Array of target companies
- `skills` (JSONB) - Array of skills
- `career_goals` (TEXT) - Free-form goals
- `communication_style` - 'direct' | 'encouraging' | 'balanced'
- `detail_preference` - 'brief' | 'moderate' | 'detailed'
- `created_at`, `updated_at` - Timestamps

**Update Mechanism:**
- Explicit user input (when implemented)
- Extracted from conversations (future enhancement)
- Manual updates via `upsertUserProfile()` API

**Usage:**
- Injected into query prompts for personalization
- Adapts communication style based on preferences
- References target companies naturally in responses

#### Layer 2: Episodic Memory (Session Summaries)
**Storage:** `session_memories` table in Supabase

**Fields:**
- `user_id` (TEXT) - Links to user
- `session_id` (TEXT) - Unique session identifier
- `summary` (TEXT) - 2-sentence conversation summary
- `key_decisions` (JSONB) - Array of decisions made
- `topics_discussed` (JSONB) - Array of topics
- `action_items` (JSONB) - Array of user action items
- `sentiment` (TEXT) - 'positive' | 'neutral' | 'frustrated' | 'anxious'
- `created_at` (TIMESTAMPTZ) - Timestamp

**Update Mechanism:**
- **Fire-and-forget** session summarization after each conversation
- Uses GPT-4o-mini to extract summary, decisions, topics, actions, sentiment
- Zero latency impact (runs asynchronously)
- Stores in background without blocking response

**Usage:**
- Retrieves last 3-5 sessions for context
- Injected into prompts for continuity
- Natural references like "Based on our last conversation..."

#### Layer 3: Procedural Memory (Coaching Style)
**Storage:** Fields in `user_profiles` table

**Fields:**
- `communication_style` - Learned from user reactions (future)
- `detail_preference` - Learned from user feedback (future)

**Current Status:** ⚠️ Not yet implemented - fields exist but no learning mechanism

**Planned Implementation:**
- Track user reactions (thumbs up/down, explicit feedback)
- Update preferences based on positive reactions
- Adapt future responses to learned preferences

**Memory Retrieval:**
- `getMemoryContext(userId)` combines all three layers
- Returns formatted context string for prompt injection
- Non-blocking - returns empty if retrieval fails
- Used in `/api/query` route before LLM call

**API Functions:**
- `getUserProfile(userId)` - Fetch semantic memory
- `upsertUserProfile(profile)` - Update semantic memory
- `getRecentSessions(userId, limit)` - Fetch episodic memory
- `summarizeSessionAsync(userId, sessionId, messages)` - Create episodic memory
- `getMemoryContext(userId)` - Combined retrieval

---

### 4.4 Evaluation Framework

**Purpose:** Ensure coaching quality meets high standards using LLM-as-judge

**Evaluation Dimensions (1-5 scale each):**

1. **Actionability** - Can user act on this within 48 hours?
   - 5: Specific, immediate actions with clear steps
   - 1: Not actionable, purely informational

2. **Personalization** - Is this specific to their resume?
   - 5: References exact projects/experiences from contexts
   - 1: Completely generic, could apply to anyone

3. **Honesty** - Does it acknowledge uncertainty appropriately?
   - 5: Explicitly acknowledges gaps and limitations
   - 1: Makes definitive claims without evidence

4. **Grounding** - Is every claim traceable to retrieved context?
   - 5: Every claim directly supported by context excerpts
   - 1: Claims appear to be invented

**Overall Score:** Average of 4 dimensions, scaled to 0-100

**Implementation:**
- `evaluateCoachingQuality()` function in `lib/evals/coaching-quality.ts`
- Uses GPT-4o-mini as judge (same model for consistency)
- Stores results in `evals` table in Supabase
- Non-blocking evaluation (doesn't delay responses)

**Evaluation Triggers:**
- Report agent evaluates each section (resume analysis, gap analysis, cover letter, interview prep, strategy)
- Manual evaluation via `/api/evals/coaching-quality` endpoint
- Future: Automatic evaluation of all query responses

**Admin Dashboard:**
- `/admin/evals` displays evaluation metrics
- Shows average scores across all dimensions
- Lists lowest-scoring responses for improvement
- Detailed view with reasoning for each eval

**API Endpoints:**
- `POST /api/evals/coaching-quality` - Evaluate a response
- `GET /api/admin/evals` - Fetch evaluation statistics

---

## 5. AI-Specific Success Criteria

| Metric | Target | Measurement Method | Current Status |
|--------|--------|-------------------|----------------|
| **Response grounding** | ≥95% based on resume | Manual audit + LLM judge | ✅ Implemented via strict prompts |
| **Hallucination rate** | <3% | Citation verification | ✅ Tracked via grounding scores |
| **Personalization score** | ≥80/100 | LLM-as-judge eval | ✅ Measured in evals |
| **Actionability score** | ≥85/100 | LLM-as-judge eval | ✅ Measured in evals |
| **Session continuity** | User context retained | Memory retrieval success rate | ✅ Implemented, needs testing |
| **Cover letter quality** | ≥90/100 | LLM-as-judge eval | ✅ Measured in report evals |
| **Memory retrieval** | <200ms latency | Performance monitoring | ✅ Non-blocking implementation |
| **Session summarization** | 100% success rate | Background job monitoring | ✅ Fire-and-forget implemented |

---

## 6. Failure Modes & Mitigations

| Failure Mode | Impact | Mitigation | Status |
|--------------|--------|------------|--------|
| **Hallucinated experience** | User claims false credentials | Strict grounding prompt + citation requirement | ✅ Implemented |
| **Generic advice** | No value over ChatGPT | Personalization eval, reject low scores | ✅ Evaluated |
| **Outdated job market info** | Bad recommendations | Acknowledge knowledge cutoff, suggest verification | ⚠️ Needs prompt update |
| **Overconfidence on salary** | User negotiates poorly | Add confidence scores, suggest research | 📋 Planned |
| **Missing context** | Advice doesn't fit situation | Memory system + explicit "what am I missing?" prompt | ✅ Memory implemented |
| **Harmful career advice** | User makes bad life decision | HITL for major pivots, escalation triggers | 📋 Planned |
| **Memory retrieval failure** | No context continuity | Non-blocking, graceful degradation | ✅ Implemented |
| **Session summarization failure** | No episodic memory | Fire-and-forget, doesn't block responses | ✅ Implemented |
| **Vector search returns no results** | Can't ground response | Fallback message, suggest re-uploading resume | ✅ Implemented |

---

## 7. Guardrails & Safety

### Will Do:
- ✅ Resume-grounded career guidance
- ✅ Interview preparation
- ✅ Cover letter drafting
- ✅ Skills gap analysis
- ✅ Job search strategy
- ✅ Memory-based continuity

### Won't Do:
- ❌ Salary negotiation specific numbers (will provide frameworks)
- ❌ Legal advice (discrimination, contracts)
- ❌ Mental health counseling (will suggest resources)
- ❌ Financial planning
- ❌ Guaranteed job placement claims
- ❌ Resume editing/writing (analysis only)

### Escalation Triggers (Planned):
- User mentions burnout, anxiety, depression → Suggest professional support
- User considering major life decision (relocation, career pivot) → HITL review
- User asks about protected characteristics in hiring → Provide factual info, suggest legal counsel
- Low evaluation scores (<60/100) → Flag for human review

**Current Status:** ⚠️ Escalation triggers not yet implemented

---

## 8. Technical Architecture

### System Overview
```
User → Next.js Frontend (React)
         ↓
    PDF Upload → pdf-parse → Chunking (1000/200) → OpenAI Embeddings
         ↓                                    ↓
    /api/upload                          Supabase pgvector
         ↓                                    ↓
    User Query → /api/query → Vector Search → Retrieved Chunks
         ↓                                    ↓
    Memory Retrieval ←──────────────── user_profiles, session_memories
         ↓
    Grounded LLM Response (gpt-4o-mini, temp=0.2)
         ↓
    Evaluation (LLM-as-judge, async)
         ↓
    Response to User + Eval stored + Session summarized
```

### Technology Stack
- **Frontend:** Next.js 16, React 19, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API Routes (serverless)
- **Vector DB:** Supabase with pgvector (1536 dimensions)
- **Embeddings:** OpenAI text-embedding-3-small
- **LLM:** OpenAI GPT-4o-mini (temperature 0.2)
- **Orchestration:** LangGraph (for multi-agent pipeline)
- **Analytics:** PostHog (optional)

### Database Schema

**Tables:**
1. `documents` - Resume chunks with embeddings
   - `id` (BIGSERIAL), `content` (TEXT), `metadata` (JSONB), `embedding` (vector(1536))

2. `evals` - Coaching quality evaluations
   - `id` (UUID), `response_id` (TEXT), `query` (TEXT), `response` (TEXT)
   - `contexts` (JSONB), `scores` (JSONB), `reasoning` (TEXT), `overall_score` (FLOAT)

3. `user_profiles` - Semantic memory
   - `id` (UUID), `user_id` (TEXT, unique), profile fields, preferences

4. `session_memories` - Episodic memory
   - `id` (UUID), `user_id` (TEXT), `session_id` (TEXT), summary fields

**RPC Functions:**
- `match_documents(query_embedding, match_count)` - Vector similarity search

### API Architecture

**13 API Routes:**
- Core: `/api/query`, `/api/upload`
- Agents: 7 specialized agent routes
- Admin: `/api/admin/evals`
- Evaluation: `/api/evals/coaching-quality`
- Legacy: `/api/analyze`, `/api/ingest`

**Memory Integration:**
- `/api/query` fully integrated with memory system
- Retrieves user profile and recent sessions
- Adapts communication style
- Summarizes sessions asynchronously

---

## 9. Current Status & Roadmap

### Completed ✅

#### Core Infrastructure
- ✅ RAG pipeline with vector search
- ✅ PDF upload and chunking
- ✅ Embedding generation and storage
- ✅ Vector similarity search

#### Multi-Agent System
- ✅ 7 specialized agents implemented
- ✅ Report compiler (all-in-one)
- ✅ Agent evaluation integration

#### Memory System
- ✅ Semantic memory (user profiles)
- ✅ Episodic memory (session summaries)
- ✅ Memory retrieval and injection
- ✅ Fire-and-forget session summarization
- ✅ Communication style adaptation

#### Evaluation Framework
- ✅ LLM-as-judge evaluation
- ✅ 4-dimension scoring
- ✅ Evaluation storage
- ✅ Admin dashboard

#### Frontend
- ✅ Chat interface
- ✅ Resume upload
- ✅ Agent action buttons
- ✅ Admin evals dashboard

### In Progress 🔄

- 🔄 HITL approval workflows for high-stakes outputs
- 🔄 Confidence scores visible in UI
- 🔄 Agent attribution in responses
- 🔄 User profile management UI

### Planned 📋

#### Short-term (Q1 2025)
- 📋 Procedural memory learning from user reactions
- 📋 User profile creation/editing UI
- 📋 Memory visualization dashboard
- 📋 Escalation triggers for safety
- 📋 Confidence scores in responses

#### Medium-term (Q2 2025)
- 📋 Voice interface for interview practice
- 📋 Network intelligence (warm intro suggestions)
- 📋 Longitudinal career journal
- 📋 Multi-resume support
- 📋 Export career reports to PDF

#### Long-term (Q3-Q4 2025)
- 📋 Collaborative features (share reports)
- 📋 Integration with job boards
- 📋 ATS optimization suggestions
- 📋 Interview feedback analysis
- 📋 Career trajectory modeling

---

## 10. Open Questions

### Technical
- **Q:** How long should session memories be retained?
  - **Current:** No retention policy
  - **Consideration:** Privacy, storage costs, relevance decay

- **Q:** Should users be able to edit their semantic profile directly?
  - **Current:** No UI, only API
  - **Consideration:** User control vs. learned preferences

- **Q:** What's the right confidence threshold for HITL triggers?
  - **Current:** Not implemented
  - **Consideration:** Balance safety vs. user experience

### Product
- **Q:** Should we support multiple resumes per user?
  - **Current:** Single resume per session
  - **Consideration:** Career transitioners may have multiple versions

- **Q:** How do we handle outdated resume information?
  - **Current:** User must re-upload
  - **Consideration:** Versioning, update mechanism

- **Q:** Should evaluation scores be visible to users?
  - **Current:** Admin-only
  - **Consideration:** Transparency vs. user confusion

### Business
- **Q:** What's the monetization model?
  - **Current:** Free/demo
  - **Consideration:** Freemium, subscription, enterprise

- **Q:** How do we scale memory system for millions of users?
  - **Current:** Single Supabase instance
  - **Consideration:** Sharding, caching, archival

---

## 11. Success Metrics

### User Engagement
- **Daily Active Users (DAU)**
- **Sessions per user per week**
- **Resume uploads per week**
- **Agent usage distribution**

### Quality Metrics
- **Average evaluation score** (target: ≥85/100)
- **Hallucination rate** (target: <3%)
- **User satisfaction** (thumbs up/down)
- **Action item completion rate** (future)

### Technical Metrics
- **Query latency** (p50, p95, p99)
- **Memory retrieval success rate**
- **Session summarization success rate**
- **Vector search accuracy**

### Business Metrics
- **User retention** (7-day, 30-day)
- **Conversion rate** (free → paid, if applicable)
- **Cost per user** (API costs)
- **Revenue per user** (if monetized)

---

## 12. Risk Assessment

### High Risk
1. **Hallucination leading to false credentials**
   - **Mitigation:** Strict grounding, evaluation, citations
   - **Status:** ✅ Implemented

2. **Generic advice reducing value proposition**
   - **Mitigation:** Personalization evaluation, RAG grounding
   - **Status:** ✅ Evaluated

### Medium Risk
3. **Memory system performance at scale**
   - **Mitigation:** Non-blocking retrieval, caching
   - **Status:** ✅ Implemented, needs load testing

4. **Cost scaling with usage**
   - **Mitigation:** GPT-4o-mini, efficient chunking, caching
   - **Status:** ⚠️ Monitor API costs

### Low Risk
5. **User data privacy concerns**
   - **Mitigation:** RLS policies, data retention policies
   - **Status:** ✅ Implemented

---

## 13. Dependencies

### External Services
- **Supabase** - Vector database, user data storage
- **OpenAI** - Embeddings and LLM
- **Vercel** - Hosting (if deployed)
- **PostHog** - Analytics (optional)

### Internal Dependencies
- **LangChain** - LLM orchestration
- **LangGraph** - Multi-agent pipeline
- **pdf-parse** - PDF text extraction
- **Next.js** - Framework

### Critical Path
- Supabase availability → All features
- OpenAI API → All AI features
- Memory tables created → Memory system functional

---

## 14. Appendix

### API Reference
See `PROJECT_AUDIT.md` for complete API route documentation.

### Database Schema
See `supabase-memory.sql` and `supabase-evals.sql` for table definitions.

### Code Structure
- `/app/api/` - API routes
- `/lib/agents/` - Agent implementations
- `/lib/memory/` - Memory system
- `/lib/evals/` - Evaluation framework
- `/lib/rag.ts` - RAG utilities

### Related Documents
- `PROJECT_AUDIT.md` - Technical audit
- `CURRENT_STATE_AUDIT.md` - Current implementation status
- `docs/SETUP.md` - Setup instructions
- `docs/MCP_SERVERS_SETUP.md` - MCP server configuration

---

*This PRD is a living document. See [Decision Log](./DECISION_LOG.md) for rationale behind key choices.*

**Last Updated:** December 2024  
**Next Review:** January 2025




