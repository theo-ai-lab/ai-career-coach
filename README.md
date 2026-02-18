# AI Career Coach

**Production AI career coaching platform powered by multi-agent orchestration, RAG, and LLM-based evaluation.**

Built as a solo project to solve a real problem: career advice is either generic (ChatGPT) or expensive (human coaches). This platform delivers personalized, grounded career guidance using specialized AI agents that collaborate through a shared memory system.

**57+ users · 900+ queries processed · 0.97 grounding accuracy · 0.94 personalization score**

[Live Demo](https://ai-career-coach-hazel.vercel.app) · [LinkedIn](https://linkedin.com/in/theobermudez) · [Architecture Doc](docs/ARCHITECTURE.md)

![App Screenshot](docs/screenshot.png)

---

## System Architecture

```
┌───────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                         │
│        Next.js 16 · Tailwind CSS · shadcn/ui              │
└─────────────────────────┬─────────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────────┐
│                      API LAYER                            │
│   /api/upload    /api/query    /api/agents    /api/eval   │
└────┬────────────────┬──────────────┬──────────────┬───────┘
     │                │              │              │
┌────▼─────┐  ┌───────▼──────┐  ┌───▼──────┐  ┌───▼────────┐
│   RAG    │  │  LangGraph   │  │   Eval   │  │  Memory    │
│ Pipeline │  │  Multi-Agent │  │Framework │  │  System    │
│          │  │ Orchestrator │  │(LLM-as-  │  │ (3-layer)  │
│          │  │              │  │  judge)  │  │            │
└────┬─────┘  └───────┬──────┘  └───┬──────┘  └───┬────────┘
     │                │              │              │
┌────▼────────────────▼──────────────▼──────────────▼────────┐
│              DATA LAYER — Supabase                         │
│    PostgreSQL 15 · pgvector · HNSW cosine similarity       │
└────────────────────────┬──────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────┐
│              EXTERNAL APIs                                │
│  OpenAI text-embedding-3-small · gpt-4o-mini              │
└───────────────────────────────────────────────────────────┘
```

---

## How It Works

### RAG Pipeline (this repo)
1. **Upload** — User uploads resume as PDF
2. **Chunk** — `RecursiveCharacterTextSplitter` (800 chars, 200 overlap)
3. **Embed** — `text-embedding-3-small` → 1536-dim vectors
4. **Store** — Supabase pgvector with HNSW indexing
5. **Retrieve** — Cosine similarity search via `match_documents` RPC (threshold: 0.78, top-5)
6. **Generate** — `gpt-4o-mini` with strict grounding prompt (temperature: 0.3)
7. **Track** — PostHog analytics on every query and response

### Multi-Agent Orchestration (private repo)
The agent layer runs as a LangGraph `StateGraph` with a supervisor pattern:

| Agent | Purpose | Key Tools |
|-------|---------|-----------|
| **Supervisor** | Intent classification, routing, escalation detection | `intent_classifier`, `escalation_detector` |
| **Resume Analyzer** | Parse resume, score against target roles, ATS check | `resume_parser`, `keyword_optimizer`, `ats_checker` |
| **Job Matcher** | Find relevant postings, benchmark salary | `job_board_searcher`, `salary_benchmarker` |
| **Gap Finder** | Identify skill gaps, estimate timelines, recommend resources | `skills_gap_analyzer`, `timeline_estimator` |
| **Cover Letter Writer** | Generate grounded cover letters with citation tracking | `draft_generator`, `tone_optimizer` |
| **Interview Prep** | Generate role-specific questions, evaluate mock answers | `question_generator`, `answer_evaluator` |
| **Career Advisor** | Long-term strategy, pivot analysis, pattern detection | `career_trajectory_analyzer`, `reality_check_generator` |
| **Report Compiler** | Aggregate all outputs into 30/60/90 action plan | `report_aggregator`, `pdf_generator` |

Routing uses conditional edges in the StateGraph based on classified intent. Cross-session state persists via Supabase checkpointing. High-stakes outputs (cover letters, career pivots) trigger `interrupt()` for human-in-the-loop approval.

### Evaluation Framework (private repo)
Every query-response pair runs through two async evaluation tracks:

**Track 1 — RAGAS (RAG quality)**
- Faithfulness (≥ 0.85 threshold)
- Answer relevancy (≥ 0.80)
- Context precision (≥ 0.75)
- Context recall (≥ 0.70)

**Track 2 — LLM-as-judge (coaching quality)**
- Actionability — Is the advice executable within 48 hours?
- Personalization — Is it tailored to this specific user's situation?
- Honesty — Does it acknowledge limitations and uncertainty?
- Grounding — Is every claim traceable to retrieved context?

Composite score formula weights faithfulness (0.25), answer relevancy (0.20), actionability (0.20), personalization (0.15), honesty (0.10), grounding (0.10). Responses scoring below 0.65 get flagged for review.

The evaluation methodology follows a **continuous calibration** approach: identify failure mode → trace through agent logs → adjust routing or prompt logic → re-run eval suite → measure delta.

### Memory System
Three-layer architecture with different retention and retrieval patterns:

| Layer | What it stores | Write pattern | Read pattern |
|-------|---------------|---------------|--------------|
| **Semantic** | Career goals, skills, target roles, education | Extracted from onboarding, updated on new info | Injected into every agent call |
| **Episodic** | Session summaries, decisions, action items, sentiment | Background job post-session (zero latency impact) | Last N summaries in system prompt |
| **Procedural** | Coaching style preferences (direct vs. encouraging, data-heavy vs. narrative) | Inferred from engagement signals over time | Shapes all agent response generation |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Vector DB | Supabase pgvector (PostgreSQL 15, HNSW indexing) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Generation | OpenAI `gpt-4o-mini` |
| Agent orchestration | LangGraph `StateGraph` with conditional edges |
| RAG evaluation | RAGAS (faithfulness, relevancy, precision, recall) |
| LLM-as-judge | Custom `AspectCritic` (4 coaching quality dimensions) |
| Memory | Supabase structured tables (semantic, episodic, procedural) |
| Analytics | PostHog |
| Deployment | Vercel |

---

## Repo Structure

```
app/
├── page.tsx                    # Landing / onboarding
├── chat/page.tsx               # Main chat interface
├── upload/page.tsx             # PDF resume upload
├── report/[session_id]/page.tsx # Generated career report
├── admin/eval/page.tsx         # Evaluation dashboard (admin)
└── api/
    ├── upload/route.ts         # PDF ingest → chunk → embed → store
    ├── query/route.ts          # RAG retrieval → grounded generation
    ├── agents/route.ts         # LangGraph execution endpoint
    ├── eval/route.ts           # Async evaluation trigger
    └── memory/route.ts         # Memory read/write operations

components/
├── chat/                       # ChatWindow, MessageBubble, SourceCitation
├── upload/                     # ResumeUploader (drag-drop PDF)
├── eval/                       # EvalDashboard, ScoreRadar, ResponseLog
├── memory/                     # MemoryPanel ("what I know about you")
└── hitl/                       # ApprovalModal (human review gate)
```

> **Note:** This repo contains the frontend application and RAG pipeline. The multi-agent orchestration layer, evaluation framework, and memory system live in a private repo — the eval methodology and agent routing logic contain proprietary patterns developed through consulting work with AI startups.

---

## Running Locally

```bash
git clone https://github.com/theo-ai-lab/ai-career-coach.git
cd ai-career-coach
npm install
```

Create `.env.local`:
```bash
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

```bash
npm run dev
```

Requires Supabase project with pgvector extension enabled and `match_documents` RPC function deployed. See `supabase/schema.sql` for full database setup.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **LangGraph over CrewAI** | Needed fine-grained control over state transitions and conditional routing — CrewAI abstracts too much for production guardrails |
| **Supervisor pattern over flat agents** | Single entry point enables consistent intent classification and escalation detection before routing |
| **pgvector over Pinecone** | Co-located with application data in Supabase — eliminates network hop for joins between vector search and user profiles |
| **HNSW over IVFFlat** | Better recall at query time for the dataset size; build time tradeoff is acceptable |
| **Async eval (fire-and-forget)** | Zero latency impact on user experience — eval runs after response delivery |
| **Three-layer memory** | Different information types need different retention policies and retrieval patterns |
| **Temperature 0.3 for generation** | Prioritizes factual grounding over creative responses — career advice should be reliable, not novel |
| **Human-in-the-loop on high-stakes** | Cover letters and career pivot advice carry real consequences — AI should propose, human should approve |

---

## Methodology

**Continuous Calibration / Continuous Development (CC/CD):**
Adapted from the scientific method for prompt optimization. Each iteration cycle:
1. Identify failure mode through eval scores and agent trace logs
2. Form hypothesis about root cause (routing error vs. prompt gap vs. retrieval miss)
3. Adjust the specific component (prompt, routing logic, retrieval threshold)
4. Re-run eval suite across 200+ simulated user personas
5. Measure delta — ship only if composite score improves without regression on any dimension

Error budgets govern releases: if any eval dimension drops below threshold, the update doesn't ship.

---

*Built by [Theo Bermudez](https://linkedin.com/in/theobermudez) · USC Marshall & Viterbi '24 · AI Career Coach is a production system, not a demo.*
