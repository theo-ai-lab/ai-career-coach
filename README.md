# AI Career Coach

[![CI](https://github.com/theo-ai-lab/ai-career-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/theo-ai-lab/ai-career-coach/actions/workflows/ci.yml)

**Prototype — AI career coaching with multi-agent orchestration, resume-grounded RAG, and a 4-dimension LLM-as-judge eval rubric. Every headline claim below is past tense and on disk: it links to its committed artifact and to the CI gate that re-derives it on every push.**

## Evidence

| Claim | Committed artifact | CI gate that re-derives it |
|-------|--------------------|----------------------------|
| **Red-team run (May 2026)** — 25 adversarial prompts against production; 6 failed / 9 material / 5 minor / 5 none | [`red-team-raw-results.json`](data/eval-benchmark/red-team-raw-results.json) · [observations](data/eval-benchmark/red-team-observations.md) | [claims-drift](.github/workflows/ci.yml) — τ and the cascade slice below are re-derived from this raw file on every push (`npm run check:claims`) |
| **OOD abstention threshold τ** — split-conformal calibrated to a fixed abstain budget, not hand-set | [`ood-calibration.json`](lib/quality-gates/ood-calibration.json) · [calibration doc](docs/OOD_GATE_CALIBRATION.md) | [claims-drift](.github/workflows/ci.yml) — `calibrate-ood-gate.ts --check` re-derives the artifact; `check-calibration-docs.ts` re-parses every documented number |
| **Measured cascade slice** — how much the deterministic OOD fast path resolves before any LLM call | [`cascade-replay.json`](lib/quality-gates/cascade-replay.json) · [the measured sentence](#quality-gates-live-request-path) | [claims-drift](.github/workflows/ci.yml) — `check-readme-sentence.ts` byte-compares that sentence against `buildMeasuredSentence()` |
| **Benchmark cases on disk: 6** (5 normal / 1 adversarial / 0 edge; v3 scaffold) | [`cases/`](data/eval-benchmark/cases) · [COVERAGE.md](data/eval-benchmark/COVERAGE.md) | [coverage-consistency](.github/workflows/ci.yml) — `check-coverage-counts.mjs` counts the files and checks the COVERAGE.md grid (`npm run check:coverage`) |
| **Keyless demo** — abstention and human-review routing with zero keys, zero model calls | [`/demo`](app/demo/page.tsx) · [`lib/demo/`](lib/demo) artifacts (labeled synthetic) | [claims-drift](.github/workflows/ci.yml) — `build-demo-artifacts.ts --check` re-derives the demo corpus and demo τ (`npm run check:demo`) |

An early-2026 pilot (~57 users / 900+ queries) predates this repo's evidence discipline: its analytics lived in a PostHog/Supabase account that is no longer accessible, are unrecoverable, and are claimed nowhere below.

**Try the gates without keys:** the `/demo` route runs the system's core behavior — abstaining on out-of-distribution questions instead of hallucinating, and routing high-stakes ones to human review — with no API key and no backend. Everything model-shaped there is committed, labeled data (fictional persona, deterministic demo embeddings, canned answers); the gate decisions are made by the production gate modules at request time. See [Keyless demo](#keyless-demo-demo).

Built as a solo project to solve a real problem: career advice is either generic (ChatGPT) or expensive (human coaches). This platform delivers personalized, grounded career guidance using specialized AI agents that collaborate through a shared memory system.

**A preregistered, falsifiable 4-dimension LLM-as-judge eval framework — N=6 cases on disk today (v3 scaffold), N=12 cross-vendor adversarial target (v4)** — see [COVERAGE.md](data/eval-benchmark/COVERAGE.md) for the canonical case inventory and [EVAL_DESIGN.md](docs/EVAL_DESIGN.md) for the rubric.

[LinkedIn](https://linkedin.com/in/theobermudez) · [PRD](docs/PRD.md) · [Metrics](docs/METRICS_FRAMEWORK.md) · [Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) · [Decision Log](docs/DECISION_LOG.md) · [Eval Framework](docs/EVAL_DESIGN.md)

### What to read first

- [**Eval benchmark methodology**](data/eval-benchmark/README.md) — Three Gulfs anchoring, preregistered judge architecture, falsifiability conditions, cost budget. The methodology document.
- [**Red-team findings (May 2026)**](data/eval-benchmark/red-team-observations.md) — 25 adversarial prompts run against production. 6 failed / 9 material / 5 minor / 5 none. Strongest finding: the live LLM-as-judge scored a clear false-confirmation 85/100 on `mr-02`, exposing a blind spot in the rubric itself.
- [**Preregistration memo (decision pending data)**](data/eval-benchmark/PM_DECISION_MEMO.md) — a preregistered three-way decision threshold for a *planned* production model migration (gpt-4o-mini → a newer-generation model pair; the specific target IDs are illustrative and not finalized). Thresholds are fixed in advance; direction-of-effect is the gating signal, CI bounds are reported for transparency only. The run results are not yet authored — current grid is N=6, v4 target N=12.
- [**OOD gate calibration**](docs/OOD_GATE_CALIBRATION.md) — how the pre-generation abstention threshold is **calibrated** (split-conformal to a target abstain budget), held-out scored once, and verified — not hand-set. The score's functional form and α are fixed a priori; only τ is fit, and a script + test re-derive it from the committed red-team data.
- [**Decision Log**](docs/DECISION_LOG.md) — 15 dated decisions with options-considered tables and implementation refs. Decisions 1-13 documented retroactively (see header note); Decisions 14-15 written contemporaneously. Example: Decision 14 (LLM-as-judge temperature 0) explains why eval reproducibility took precedence over generation diversity.

![App Screenshot](docs/screenshot.png)

---

## About this repo

Built solo from November 2025 onward. Three architectural milestones live in the public commit log: working RAG with grounded retrieval (Nov 2025), LLM-as-judge evaluation and three-layer memory system (Dec 2025), and multi-agent LangGraph orchestration with HITL detection (Dec 2025). Full architecture decisions in [docs/DECISION_LOG.md](docs/DECISION_LOG.md), evaluation methodology in [docs/EVAL_DESIGN.md](docs/EVAL_DESIGN.md).

This is a prototype: a Vercel frontend is live, but the early-2026 pilot's backend is no longer accessible (the pilot itself is covered by the one-line note under [Evidence](#evidence)). There is no auth, rate limiting, or end-to-end outcome tracking yet — those are planned, not built.

Known failure modes surfaced by the red-team (May 2026) — including a cross-conversation memory leak in `/api/query` traced to `userId = resumeId` aliasing — are documented in [`data/eval-benchmark/red-team-observations.md`](data/eval-benchmark/red-team-observations.md) and partially mitigated. The fix shipped behind a `skipMemory: true` request-body flag (see `app/api/query/route.ts` and the comment block at lines 28-33) so eval runs get clean stateless responses without changing default behavior for real users.

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
2. **Chunk** — `RecursiveCharacterTextSplitter` (1000 chars, 200 overlap)
3. **Embed** — `text-embedding-3-small` → 1536-dim vectors
4. **Store** — Supabase pgvector with HNSW indexing
5. **Retrieve** — Cosine similarity search via `match_documents_v2` RPC, scoped in SQL by `resume_id` / `user_id` before returning the top chunks
6. **Generate** — `gpt-4o-mini` with strict grounding prompt (temperature: 0.2)
7. **Track** — PostHog analytics on every query and response

### Quality Gates (live request path)

> Product framing of this capability ("Trustworthy Answering") lives in [docs/PRD.md](docs/PRD.md); the signals below map to a measurable event taxonomy in [docs/METRICS_FRAMEWORK.md](docs/METRICS_FRAMEWORK.md); what's next is in [docs/ROADMAP.md](docs/ROADMAP.md).

`/api/query` runs four reliability gates from `lib/quality-gates/` on the live path; their signals are returned in the response payload and surfaced in the UI. Each is a **cheap → expensive** boundary: a cheap deterministic tier resolves what it can and only escalates to the expensive tier it guards.

- **OOD / retrieval-surprise screen** (`ood-gate.ts`) — *regime: model-free · locus: turn*. **Before generation**, scores how *surprising* the query is to the résumé corpus from the top-k cosine similarities the pgvector RPC **already returned** (KEYLESS — no extra embedding/LLM call). Above a **conformal-calibrated** threshold it short-circuits a clearly-off-résumé query ("which Pokémon should I use?", "should I raise my Lexapro dose?") with an honest "that isn't in your background — want to add it?" instead of letting the model confabulate. The threshold is **not a magic constant**: it is the split-conformal quantile for a target abstain budget (α = 0.15), calibrated from the committed red-team run and documented in [docs/OOD_GATE_CALIBRATION.md](docs/OOD_GATE_CALIBRATION.md). Below threshold the request falls through to the gates below, unchanged.
- **Data-density confidence + HITL routing** (`data-density.ts`) — *regime: model-free · locus: turn*. Estimates how well the retrieved chunks support the query from their cosine similarities. A sparse region lowers the stated confidence and routes to human review; this is combined with the existing keyword high-stakes gate (`hitl-detection.ts`).
- **Info-gain-gated re-retrieval** (`info-gain.ts`, composed in `retrieval-pipeline.ts`) — *regime: model-free · locus: step*. When the first retrieval is not dense, the query is expanded with the user's stored profile terms (a deterministic, key-free reformulation) and a second retrieval round-trip fires **only** if that reformulation carries enough new information; otherwise the redundant call is skipped. The denser page wins.
- **Satisficing stop** (`satisficing.ts`) — *regime: model-based-residual · locus: turn*. Generation is judged against the coaching-quality rubric and stops as soon as the answer clears the bar, only revising when it does not. A well-scored first draft costs exactly one generation + one judge call.

**Per-gate cascade telemetry** (`cascade-telemetry.ts`) logs each gate's skip-vs-escalate decision and exposes one consistent contract per cheap→expensive boundary: `alpha` (fraction the cheap tier resolved without escalating), `disagreementRate` (when both tiers run), and `losslessViolations` (cheap resolutions the expensive tier would *not* have made). For the OOD-gate → LLM-generation boundary these are **measured offline** by replaying the committed red-team run against its already-recorded judge scores — zero extra model spend:

> On the committed 24-query red-team replay, the deterministic OOD fast path resolves 8.3% of queries (the clearly-off-résumé tail) before any LLM call with 0 lossless violations and 0.0% measured disagreement; the expensive LLM-generation + judge tier touches the remaining 91.7%.

(That sentence is regenerated from the committed `cascade-replay.json` by `buildMeasuredSentence()`, so the docs and the code cannot disagree — CI byte-compares the two on every push (`npm run check:claims`) and fails the build on drift. n = 24, so it is a measured statement about this corpus with wide small-n intervals — not a guarantee about future traffic.) The other three gates expose a live runtime acceptance-rate counter but are honestly marked `losslessMeasured: false`: a lossless count for them needs a replay corpus that ran both the skip and no-skip variants through the judge, which is not committed, so it is not fabricated.

> Thresholds (`sparseSimilarity`, `denseSimilarity`, info-gain weights, satisficing targets) are documented, **unvalidated defaults** — they prove the wiring, not a tuned operating point, and must be calibrated against real traces before being trusted as release gates. The OOD threshold is the exception: it is **calibrated** (split-conformal), with a held-out split scored once and a regenerate/verify script. The gates' decision logic is pure and unit-tested offline (`npm run test:quality-gates`).

### Keyless demo (`/demo`)

The gates above are pure TypeScript over cosine similarities, so they can be *experienced* without any backend. The `/demo` route serves the abstention-instead-of-hallucination behavior with **zero keys, zero env vars, zero model calls** — every piece that would normally need a model is committed, labeled data:

- **Demo corpus** — the fictional persona already committed at [`data/eval-benchmark/personas/synthetic-redteam-resume.md`](data/eval-benchmark/personas/synthetic-redteam-resume.md), chunked and embedded into `lib/demo/demo-corpus.json`.
- **Deterministic demo embeddings** — a seeded hashed tf-idf space (`lib/demo/embeddings.ts`), **not model embeddings**: texts sharing distinctive vocabulary with the corpus cluster, fully-off-corpus queries land at cosine 0. It has no semantic understanding, and its numbers say nothing about the production embedding space.
- **A real conformal calibration over that space** — the demo threshold τ is re-derived by the **same split-conformal procedure** as production (`scripts/build-demo-artifacts.ts`), including the fixed-seed held-out check, using the committed red-team prompts as the calibration sample. The demo abstain budget (α = 0.45) is demo-specific — the script header documents why the closed-vocabulary space forces it — and is *not* the production budget. CI re-derives both demo artifacts on every push (`npm run check:demo`), and an anti-drift test (`lib/demo/demo-artifacts.test.ts`) reproduces the derivation independently.
- **Canned generation, labeled in the UI** — three scripted queries have authored answers grounded strictly in the fictional persona; free-typed questions get verbatim résumé excerpts instead of a pretend generation. The page header and every answer carry the provenance label (*demo corpus · deterministic demo embeddings · canned generation*), so any screenshot or recording is self-describing. Judge scores, satisficing, and the grounding gate are honestly `null` — those tiers need models, and demo mode does not fake them.

Only the embedding space and the answer text are synthetic: the OOD abstention, density assessment, and human-review routing are decided by the production gate modules at request time. The scripted queries are locked to their gate outcomes by tests (`lib/demo/run-demo-query.test.ts`): a grounded question that answers, a salary-negotiation question that routes to human review, and an off-résumé question the OOD gate abstains on before any answer exists.

### Multi-Agent Orchestration
The agent layer runs as a LangGraph `StateGraph` (see `lib/report-graph.ts`):

| Agent | Purpose | Key Functions |
|-------|---------|-----------|
| **Resume Analyzer** | Parse resume, extract strengths, projects, core skills | `analyzeResume`, `resumeAnalysisNode` |
| **Job Matcher** | Match resume against job description, identify gaps and keywords | `jobMatchingNode` |
| **Gap Finder** | Identify skill gaps, role fit score, recommendations | `findGaps`, `gapAnalysisNode` |
| **Cover Letter Writer** | Generate grounded cover letters with citation tracking | `writeCoverLetter`, `coverLetterNode` |
| **Interview Prep** | Generate behavioral, product, and technical questions with answers | `generateInterviewPrep`, `interviewPrepNode` |
| **Strategy Advisor** | 6-month strategy plan with monthly breakdown | `generateStrategy`, `strategyPlanNode` |
| **Report Compiler** | Aggregate all outputs into a final markdown report | `compileReportNode` |

Routing uses one conditional edge: job-matching runs only when a job description is provided. The rest of the graph executes sequentially with parallel branches for interview prep + strategy plan. High-stakes outputs (cover letters, career pivots) are flagged by `lib/hitl-detection.ts` (`detectHighStakes`). On the chat path (`/api/query`) this keyword gate is now combined with the data-density gate and surfaced as a "consider human review" banner in the UI. The per-agent cover-letter/strategy routes still only set the flag on their response — surfacing it in the report UI is pending.

The orchestrator itself is reachable from the shipped UI via the **Generate full report** action, which calls `/api/agents/report` and renders the compiled markdown with explicit loading / error / result states.

### Evaluation Framework
Every query-response pair runs through an async LLM-as-judge evaluation (see `lib/evals/coaching-quality.ts`):

**LLM-as-judge (coaching quality)**
- Actionability — Is the advice executable within 48 hours?
- Personalization — Is it tailored to this specific user's situation?
- Honesty — Does it acknowledge limitations and uncertainty?
- Grounding — Is every claim traceable to retrieved context?

Composite score is the mean of 4 LLM-judge dimensions (actionability, personalization, honesty, grounding), scaled 0–100. The chat UI surfaces a low-confidence / human-review banner driven by the live quality-gate signals (sparse data density, a high-stakes keyword, or an answer that did not clear the satisficing quality bar), plus a subtle indicator when an info-gain-gated re-retrieval was attempted, fired, or skipped.

The evaluation methodology follows a **continuous calibration** approach: identify failure mode → trace through agent logs → adjust routing or prompt logic → re-run eval suite → measure delta.

### Memory System
Three-layer architecture with different retention and retrieval patterns:

| Layer | What it stores | Write pattern | Read pattern |
|-------|---------------|---------------|--------------|
| **Semantic** | Career goals, skills, target roles, education | Extracted from onboarding, updated on new info | Injected into every agent call |
| **Episodic** | Session summaries, decisions, action items, sentiment | Background job post-session (zero latency impact) | Last N summaries in system prompt |
| **Procedural** | Coaching style preferences (direct vs. encouraging, data-heavy vs. narrative) | (planned — not yet implemented) | (planned — not yet implemented) |

> Memory currently wires into `/api/query` (chat path). The report pipeline (`/api/agents/report`) does not yet pull memory context — planned for next iteration.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Vector DB | Supabase pgvector (PostgreSQL 15, HNSW indexing) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Generation | OpenAI `gpt-4o-mini` |
| Agent orchestration | LangGraph `StateGraph` with conditional + parallel edges |
| LLM-as-judge | Custom 4-dimension rubric (actionability, personalization, honesty, grounding) |
| Memory | Supabase structured tables (semantic, episodic; procedural planned) |
| Analytics | PostHog |
| Deployment | Vercel |

---

## Repo Structure

```
app/
├── page.tsx                              # main UI: chat + resume upload + full report (calls /api/query, /api/upload, /api/agents/report)
├── demo/page.tsx                         # keyless demo UI (no env vars; committed, labeled demo data)
├── layout.tsx                            # root layout
├── providers.tsx                         # PostHog provider
└── api/
    ├── upload/route.ts                   # PDF → chunk → embed → store
    ├── query/route.ts                    # RAG retrieval → grounded generation (memory-aware)
    ├── demo/query/route.ts               # keyless demo answer path (real gate decisions, canned answers)
    ├── agents/
    │   ├── resume/route.ts               # resume analyzer
    │   ├── gap/route.ts                  # gap finder
    │   ├── job-matcher/route.ts          # job matcher
    │   ├── cover-letter/route.ts         # cover letter writer (HITL flag)
    │   ├── interview-prep/route.ts       # interview prep
    │   ├── strategy/route.ts             # 6-month strategy advisor (HITL flag)
    │   └── report/route.ts               # full report (LangGraph orchestration)
    └── evals/
        └── coaching-quality/route.ts     # standalone LLM-as-judge endpoint

components/
├── chat-message.tsx                      # shared chat renderer (live coach + demo): answer + gate banners
└── ui/                                   # shadcn primitives (button, card, input, scroll-area)

lib/
├── rag.ts                                # resume context retrieval, chat client
├── supabase.ts                           # Supabase client
├── service-config.ts                     # env/key readiness gate (honest 503 vs fake answer)
├── hitl-detection.ts                     # high-stakes keyword detection
├── report-graph.ts                       # LangGraph StateGraph orchestration
├── utils.ts                              # tailwind class merger
├── quality-gates/                        # live reliability gates (wired into /api/query)
│   ├── ood-gate.ts                       # pre-generation OOD screen (conformal-calibrated, keyless)
│   ├── ood-score.ts                      # pure OOD score + split-conformal / Wilson primitives
│   ├── ood-calibration.json              # committed calibrated threshold τ (regenerated, not hand-set)
│   ├── cascade-telemetry.ts              # per-gate alpha telemetry + suite cascade contract
│   ├── cascade-replay.json               # committed measured cascade slice (offline, zero model spend)
│   ├── data-density.ts                   # density confidence + HITL routing
│   ├── info-gain.ts                      # info-gain-gated re-retrieval
│   ├── satisficing.ts                    # satisficing stop for the critique→revise loop
│   ├── retrieval-pipeline.ts             # composes the gates into one retrieval decision
│   └── vector-math.ts                    # pure cosine/kNN helpers (+ *.test.ts for each)
├── demo/                                 # keyless /demo backing (SYNTHETIC demo space — labeled as such)
│   ├── embeddings.ts                     # deterministic hashed tf-idf demo embedder (not model embeddings)
│   ├── demo-corpus.json                  # fictional-persona chunks + demo vectors (committed artifact)
│   ├── demo-calibration.json             # demo τ, re-derived by the same conformal procedure as production
│   ├── scripted-queries.ts               # the three scripted demo queries + canned answers
│   └── run-demo-query.ts                 # keyless demo pipeline (real gate decisions; + *.test.ts for each)
├── agents/
│   ├── resume-analyzer/                  # node.ts + schema.ts
│   ├── gap-finder/                       # node.ts + schema.ts
│   ├── job-matcher/                      # schema.ts (logic lives in report-graph.ts)
│   ├── cover-letter/                     # node.ts + schema.ts
│   ├── interview-prep/                   # node.ts + schema.ts
│   ├── strategy-advisor/                 # node.ts + schema.ts
│   ├── report-generator/                 # node.ts (delegates to synthesizer)
│   └── synthesizer/                      # node.ts (aggregates per-agent outputs)
├── evals/
│   └── coaching-quality.ts               # LLM-as-judge rubric (4 dimensions)
└── memory/
    ├── index.ts                          # exports
    ├── semantic.ts                       # user_profiles CRUD
    ├── episodic.ts                       # session_memories + fire-and-forget summarizer
    └── retrieval.ts                      # unified memory context formatter
```

> **Note:** This repo contains the full system — multi-agent orchestration (`lib/report-graph.ts`, `lib/agents/`), evaluation framework (`lib/evals/coaching-quality.ts`), and memory layer (`lib/memory/`). The architectural patterns evolved through iteration documented in [docs/DECISION_LOG.md](docs/DECISION_LOG.md).

---

## Running Locally

```bash
git clone https://github.com/theo-ai-lab/ai-career-coach.git
cd ai-career-coach
npm install
```

Create `.env.local`:
```bash
OPENAI_API_KEY=<openai-api-key>
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
NEXT_PUBLIC_POSTHOG_KEY=<posthog-project-key>
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

```bash
npm run dev
```

**No keys?** The keyless demo needs none of the above: `npm run dev` (with no `.env.local` at all) and open [http://localhost:3000/demo](http://localhost:3000/demo). The keyless test suite (`npm test`) and every CI drift gate (`npm run check:claims`, `check:coverage`, `check:demo`) also run without env vars.

The live coaching path requires a Supabase project with pgvector extension enabled. SQL setup files at repo root, run in alphabetical order: `01-supabase-documents.sql` (documents table + pgvector extension + HNSW index), `02-supabase-match-documents.sql` (RPC functions for vector search), `03-supabase-memory.sql` (user profiles + session memory), `04-supabase-evals.sql` (eval logging), `05-supabase-fix.sql` (RLS policies).

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **LangGraph over CrewAI** | Needed fine-grained control over state transitions and conditional routing — CrewAI abstracts too much for production guardrails |
| **pgvector over Pinecone** | Co-located with application data in Supabase — eliminates network hop for joins between vector search and user profiles |
| **HNSW over IVFFlat** | Better recall at query time for the dataset size; build time tradeoff is acceptable |
| **Async eval (fire-and-forget)** | Zero latency impact on user experience — eval runs after response delivery |
| **Three-layer memory** | Different information types need different retention policies and retrieval patterns |
| **Temperature 0.2 for generation** | Prioritizes factual grounding over creative responses — career advice should be reliable, not novel |
| **High-stakes detection + data-density HITL** | Cover letters and career-pivot advice carry real consequences — `lib/hitl-detection.ts` flags high-stakes keywords, now combined on the chat path with the data-density confidence gate and surfaced as a "consider human review" banner. Per-agent report-route flags are not yet surfaced in the report UI |

---

## Methodology

Iterative prompt optimization, run as a standard scientific loop. Each cycle:

1. Identify failure mode through eval scores and agent trace logs
2. Form hypothesis about root cause (routing error vs. prompt gap vs. retrieval miss)
3. Adjust the specific component (prompt, routing logic, retrieval threshold)
4. Re-run eval suite across the planned 50-persona synthetic set (Planned; on disk today: 3 personas. See [`data/eval-benchmark/README.md`](data/eval-benchmark/README.md) implementation status section.)
5. Measure delta — ship only if composite score improves without regression on any dimension

Error budgets govern releases: if any eval dimension drops below threshold, the update doesn't ship.

---

*Built by [Theo Bermudez](https://linkedin.com/in/theobermudez)*
