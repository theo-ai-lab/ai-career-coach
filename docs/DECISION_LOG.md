# AI Career Coach - Decision Log

This document captures key technical and product decisions made throughout development, including context, alternatives considered, and rationale.

---

## Decision 1: Vector Database Selection

**Date:** October 2024  

**Status:** Decided  

**Context:** Needed vector storage for resume embeddings to enable semantic search. Required integration with user data (profiles, sessions, evals) in a single data layer.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| Pinecone | Purpose-built, fast, managed, excellent performance | Additional service, cost at scale, separate from relational data |
| Supabase pgvector | Integrated with existing DB, free tier, SQL familiar, single data layer | Newer, less optimized for pure vector workloads, smaller community |
| Chroma | Simple, local-first, open source | Not production-ready, no managed option, requires self-hosting |
| Weaviate | Fast, good features | Additional service, learning curve, cost |

**Decision:** Supabase pgvector

**Rationale:** 
- Single data layer for vectors + relational data (user profiles, session memories, evals)
- Reduces complexity and operational overhead
- Free tier sufficient for MVP
- Performance acceptable for our scale (<10k documents per user)
- Familiar SQL interface for team
- Can migrate to dedicated vector DB later if needed

**Implementation:** `documents` table with `embedding vector(1536)` column, `match_documents` RPC function for similarity search.

---

## Decision 2: Embedding Model

**Date:** October 2024  

**Status:** Decided  

**Context:** Need to convert resume text into vectors for semantic search. Cost and quality trade-offs.

**Options Considered:**

| Option | Dimensions | Cost | Quality | Speed |
|--------|------------|------|---------|-------|
| text-embedding-3-small | 1536 | $0.02/1M tokens | Good | Fast |
| text-embedding-3-large | 3072 | $0.13/1M tokens | Better | Medium |
| text-embedding-ada-002 | 1536 | $0.10/1M tokens | Good (legacy) | Fast |
| Cohere embed-english-v3.0 | 1024 | $0.10/1M tokens | Good | Fast |

**Decision:** text-embedding-3-small

**Rationale:** 
- Best cost/performance ratio for our use case
- Resume chunks are relatively short and domain-specific - diminishing returns from larger model
- 1536 dimensions sufficient for semantic similarity
- Can upgrade to text-embedding-3-large later if retrieval quality issues emerge
- Fast embedding generation improves UX

**Implementation:** Used in `lib/rag.ts`, `app/api/upload/route.ts`, `app/api/query/route.ts`

---

## Decision 3: Chunking Strategy

**Date:** October 2024  

**Status:** Decided  

**Context:** Resumes need to be split into chunks for embedding. Chunk size affects retrieval quality - too small loses context, too large dilutes relevance.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| 400 tokens, 100 overlap | More precise retrieval, smaller chunks | Loses context, more chunks to manage |
| 800 tokens, 200 overlap | Balanced, good context | May include irrelevant info |
| 1000 tokens, 200 overlap | Larger context, fewer chunks | Less precise, higher embedding cost |
| 1200 tokens, 300 overlap | Maximum context | Very imprecise, expensive |

**Decision:** 1000 tokens, 200 overlap (upload route) / 800 tokens, 200 overlap (ingest route)

**Rationale:** 
- Resume sections (education, experience, skills) typically fit in 800-1000 tokens
- Overlap ensures we don't lose context at section boundaries
- Tested with sample resumes - good balance of precision and context
- 200 token overlap captures section transitions (e.g., end of education, start of experience)
- Different chunk sizes in different routes due to different use cases

**Implementation:** 
- `app/api/upload/route.ts`: 1000 tokens, 200 overlap
- `app/api/ingest/route.ts`: 800 tokens, 200 overlap
- Uses `RecursiveCharacterTextSplitter` from LangChain

---

## Decision 4: Multi-Agent vs Single Prompt

**Date:** November 2024  

**Status:** Decided  

**Context:** System needs to generate cover letters, interview prep, strategy plans. Could use one flexible prompt or specialized agents.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| Single flexible prompt | Simpler, less code, single evaluation | Harder to evaluate, inconsistent quality, harder to optimize |
| Specialized agents | Focused prompts, easier to eval each, better quality | More complexity, potential redundancy, more API routes |
| LangGraph orchestration | Dynamic routing, state management, complex workflows | Steeper learning curve, overkill for MVP, more infrastructure |

**Decision:** Specialized agents (7 routes) without LangGraph initially

**Rationale:** 
- Each agent has clear success criteria and can be evaluated independently
- Focused prompts produce better quality outputs
- Ship faster, add LangGraph orchestration later if needed for complex multi-turn workflows
- Easier to A/B test individual agents
- Clear separation of concerns

**Future consideration:** Migrate to LangGraph when adding HITL approval workflows or complex multi-agent chains.

**Implementation:** 7 separate API routes in `app/api/agents/`:
- resume, gap, job-matcher, cover-letter, interview-prep, strategy, report

---

## Decision 5: Memory Architecture

**Date:** December 2024  

**Status:** Decided (Semantic + Episodic), Planned (Procedural)

**Context:** Users expect the coach to remember context across sessions. Need persistent memory without sacrificing privacy or performance.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| No memory (stateless) | Simple, no privacy concerns, no storage | Poor UX, user repeats info, no personalization |
| Session-only memory | Some continuity, simple | Lost between sessions, no long-term learning |
| Three-layer persistent | Full continuity, personalization, learning | Complexity, storage, privacy concerns, retrieval latency |
| External memory service | Managed, scalable | Additional dependency, cost, latency |

**Decision:** Three-layer memory (semantic + episodic + procedural planned)

**Rationale:** 
- Career coaching is longitudinal - users return over weeks/months
- Semantic memory stores profile (goals, preferences, target companies)
- Episodic memory stores session summaries (what was discussed, decisions made)
- Procedural memory (learning user preferences) planned for v2
- All stored in Supabase for single data layer
- Non-blocking retrieval ensures zero latency impact

**Implementation:** 
- `lib/memory/semantic.ts` - User profile CRUD
- `lib/memory/episodic.ts` - Session memory operations
- `lib/memory/retrieval.ts` - Combined context retrieval
- Supabase tables: `user_profiles`, `session_memories`
- Integrated into `app/api/query/route.ts`

---

## Decision 6: Evaluation Framework

**Date:** November 2024  

**Status:** Decided  

**Context:** Need to measure coaching quality. Traditional metrics (latency, uptime) don't capture advice quality. Need scalable evaluation.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| User ratings only | Direct signal, simple | Sparse, biased toward positive, doesn't scale |
| RAGAS metrics only | Industry standard for RAG, automated | Doesn't capture coaching quality, too technical |
| LLM-as-judge custom | Tailored to our criteria, scales | Requires careful prompt engineering, cost |
| Human eval | Gold standard, comprehensive | Doesn't scale, expensive, slow |
| Hybrid (LLM + human) | Best of both | Complex, still expensive |

**Decision:** LLM-as-judge with 4 custom dimensions + RAGAS for retrieval (future)

**Rationale:** 
- Four dimensions map to what makes career coaching valuable:
  - **Actionability:** Can user act on this within 48 hours?
  - **Personalization:** Is this specific to their resume?
  - **Honesty:** Does it acknowledge uncertainty?
  - **Grounding:** Is every claim traceable to retrieved context?
- LLM judge scales to evaluate every response
- Custom dimensions ensure we measure what matters for career coaching
- RAGAS can validate retrieval layer separately (planned)

**Implementation:** 
- `lib/evals/coaching-quality.ts` - LLM-as-judge evaluator
- `app/api/evals/coaching-quality/route.ts` - Evaluation endpoint
- Integrated into `app/api/agents/report/route.ts` for section-level evaluation
- Scores stored in `evals` table in Supabase
- Admin dashboard at `/admin/evals`

---

## Decision 7: LLM Selection for Generation

**Date:** October 2024  

**Status:** Decided  

**Context:** Need LLM for generating coaching responses, cover letters, interview prep, etc. Cost, quality, and speed trade-offs.

**Options Considered:**

| Option | Cost | Quality | Speed | Context Window |
|--------|------|---------|-------|----------------|
| gpt-4o | High ($5/1M input) | Excellent | Medium | 128k |
| gpt-4o-mini | Low ($0.15/1M input) | Very Good | Fast | 128k |
| gpt-3.5-turbo | Very Low ($0.50/1M input) | Good | Very Fast | 16k |
| Claude 3 Sonnet | Medium ($3/1M input) | Excellent | Medium | 200k |
| Claude 3 Haiku | Low ($0.25/1M input) | Good | Fast | 200k |

**Decision:** gpt-4o-mini

**Rationale:** 
- Best balance of cost, quality, and speed for our use case
- Responses are grounded in retrieved context, so the model's job is synthesis, not pure generation
- 128k context window sufficient for long conversations and reports
- Fast response times improve UX
- Can upgrade to gpt-4o for specific high-stakes outputs (salary negotiation, major career pivots) later
- Temperature set to 0.2 for consistency

**Implementation:** 
- Used throughout codebase via `getChatClient()` in `lib/rag.ts`
- Temperature: 0.2 (low for consistency)
- Model: 'gpt-4o-mini'

---

## Decision 8: Session Summarization Approach

**Date:** December 2024  

**Status:** Decided  

**Context:** Need to store session summaries for episodic memory. Must not impact response latency.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| Synchronous summarization | Simple, guaranteed storage | Blocks response, poor UX |
| Background job queue | Reliable, scalable | Infrastructure complexity, delay |
| Fire-and-forget async | Zero latency impact, simple | May fail silently, eventual consistency |

**Decision:** Fire-and-forget async summarization

**Rationale:** 
- Zero latency impact on user responses
- Simple implementation (no queue infrastructure needed)
- Acceptable trade-off: occasional missed summaries vs. guaranteed fast responses
- Can add retry logic later if needed
- Logs failures for monitoring

**Implementation:** 
- `summarizeSessionAsync()` in `lib/memory/episodic.ts`
- Called after response in `app/api/query/route.ts`
- Runs in background, doesn't block response
- Uses GPT-4o-mini to extract summary, decisions, topics, actions, sentiment

---

## Decision 9: Memory Retrieval Strategy

**Date:** December 2024  

**Status:** Decided  

**Context:** Need to retrieve memory context before generating response. Must not block if retrieval fails.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| Blocking retrieval | Guaranteed context | Latency if DB slow, fails entire request |
| Non-blocking with timeout | Fast, graceful degradation | May miss context if slow |
| Cache + async refresh | Fast, eventually consistent | Cache invalidation complexity |

**Decision:** Non-blocking retrieval with graceful degradation

**Rationale:** 
- Response quality should not depend on memory retrieval
- If memory fails, system still works (just without context)
- Try-catch ensures errors don't crash the request
- Returns empty context if retrieval fails
- Logs warnings for monitoring

**Implementation:** 
- `getMemoryContext()` in `lib/memory/retrieval.ts`
- Wrapped in try-catch in `app/api/query/route.ts`
- Returns empty context if retrieval fails
- Parallel retrieval of profile and sessions using `Promise.all()`

---

## Decision 10: Communication Style Adaptation

**Date:** December 2024  

**Status:** Decided  

**Context:** Users have different preferences for feedback style (direct vs. encouraging, brief vs. detailed).

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| Fixed style for all | Simple, consistent | Doesn't adapt to user preferences |
| User-selectable | User control | Requires UI, user may not know preference |
| Learned from reactions | Automatic, personalized | Complex, requires feedback mechanism |
| Hybrid (selectable + learned) | Best of both | Most complex |

**Decision:** User-selectable with learning planned (v2)

**Rationale:** 
- Start with explicit user preference (stored in `user_profiles.communication_style`)
- Simple to implement, gives users control
- Can add learning from reactions later (procedural memory)
- Three styles: 'direct', 'encouraging', 'balanced'
- Detail preference: 'brief', 'moderate', 'detailed'

**Implementation:** 
- Fields in `user_profiles` table: `communication_style`, `detail_preference`
- Injected into prompt in `app/api/query/route.ts`
- Adapts system prompt based on preference

---

## Decision 11: HITL Implementation Approach

**Date:** December 2024  

**Status:** In Progress  

**Context:** High-stakes outputs (salary scripts, major career pivots) need human review option. Balance safety with UX.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| No HITL | Simpler, faster | Risk of harmful advice |
| Confidence threshold trigger | Automatic escalation, scalable | Need to calibrate threshold, false positives |
| User-initiated review | User control, simple | May not know when to ask |
| Mandatory for categories | Clear rules, safe | Slower for some use cases, may be unnecessary |
| Hybrid (threshold + categories) | Flexible, safe | Complex, need to define rules |

**Decision:** Confidence threshold + category-based triggers (TBD)

**Rationale:** 
- Some topics (salary, major pivots, mental health mentions) should always offer human review
- Others can use confidence scores from evaluation
- Still defining exact thresholds and categories
- Will implement as feature flag for gradual rollout

**Future Implementation:**
- Escalation triggers for specific keywords/topics
- Confidence score threshold (e.g., <70/100 triggers review)
- UI to request human review
- Admin dashboard for reviewing flagged outputs

---

## Decision 12: Report Generation Strategy

**Date:** November 2024  

**Status:** Decided  

**Context:** Users want comprehensive career reports. Could generate all sections in parallel or sequentially.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| Sequential generation | Simple, dependencies clear | Slow, user waits |
| Parallel generation | Fast, efficient | Complex dependencies, may need reordering |
| Hybrid (some parallel) | Balanced | Moderate complexity |

**Decision:** Sequential generation with evaluation at each step

**Rationale:** 
- Sections have dependencies (gap analysis needs resume analysis)
- Sequential ensures quality and proper data flow
- Evaluation at each step catches issues early
- User downloads final report, so latency acceptable
- Can optimize later if needed

**Implementation:** 
- `app/api/agents/report/route.ts` generates sections sequentially:
  1. Resume Analysis (with eval)
  2. Job Matching (optional, if job description provided)
  3. Gap Analysis (with eval)
  4. Cover Letter (with eval)
  5. Interview Prep (with eval)
  6. Strategy Plan (with eval)
  7. Compile markdown report

---

## Decision 13: Error Handling Philosophy

**Date:** October 2024  

**Status:** Decided  

**Context:** Need to handle failures gracefully without breaking user experience.

**Options Considered:**

| Option | Pros | Cons |
|--------|------|------|
| Fail fast | Clear errors, easy debugging | Poor UX, broken flows |
| Silent failures | Never breaks | Hard to debug, user confusion |
| Graceful degradation | Good UX, debuggable | More code, complexity |

**Decision:** Graceful degradation with logging

**Rationale:** 
- Memory retrieval failures don't block responses
- Session summarization failures don't block responses
- Evaluation failures don't block responses
- All failures logged for monitoring
- User-friendly error messages
- System continues to work even if non-critical features fail

**Implementation:** 
- Try-catch blocks around non-critical operations
- Console warnings for failures
- User-friendly error messages
- Non-blocking async operations

---

## Decisions Pending

| Topic | Status | Blocking | Notes |
|-------|--------|----------|-------|
| Memory retention period | Needs research | Privacy policy | How long to keep session summaries? |
| User profile editing | Needs design | UI/UX sprint | How should users edit their profile? |
| Voice interface | Evaluating options | Resource allocation | For interview practice |
| Procedural memory learning | Planned | Feedback mechanism | How to learn from user reactions? |
| Multi-resume support | Planned | Data model | How to handle multiple resume versions? |
| Confidence score thresholds | In progress | Calibration | What scores trigger HITL? |
| RAGAS integration | Planned | Evaluation framework | Add RAG-specific metrics |

---

## Decision Principles

Throughout development, we've followed these principles:

1. **Ship fast, iterate** - Prefer working solutions over perfect ones
2. **Graceful degradation** - System should work even if non-critical features fail
3. **Single data layer** - Prefer Supabase for all data (vectors + relational)
4. **Cost-conscious** - Choose cost-effective options (gpt-4o-mini, text-embedding-3-small)
5. **User control** - Give users explicit control over preferences
6. **Quality over speed** - Sequential generation ensures quality
7. **Scalable evaluation** - LLM-as-judge scales with usage
8. **Privacy-first** - Memory system respects user data, clear retention policies needed

---

*Last updated: December 2024*  
*Next review: January 2025*











