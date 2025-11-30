# 🔍 Gap Finder Agent - Product Requirements Document

> **AI Career Coach Portfolio Project**  
> Full-stack LangGraph multi-agent system with Supabase RAG

---

## 🎯 Problem & User Persona

### Problem Statement
Job seekers struggle to identify specific skill gaps between their current resume and target job descriptions. Without clear, prioritized guidance, they waste time learning irrelevant skills or miss critical requirements that would significantly improve their candidacy.

### User Persona: **Jordan - The Career Pivoter**
- **Age**: 30-40
- **Background**: Mid-level professional transitioning to a new industry/role
- **Pain Points**:
  - Doesn't know which skills are most critical for the target role
  - Overwhelmed by long job descriptions with unclear priorities
  - Wants a data-driven upskilling roadmap, not generic advice
  - Needs to understand role fit before investing time in applications
- **Goals**:
  - Get precise gap analysis between resume and job description
  - Understand role fit score to prioritize applications
  - Receive prioritized, actionable upskilling plan
  - Identify missing experiences that are blockers vs. nice-to-haves

---

## 🎯 Goals & Success Metrics

### Primary Goals
1. **Precise Gap Identification**: Accurately identify missing technical skills, soft skills, and experiences
2. **Role Fit Scoring**: Provide 0-100 score indicating how well resume matches job requirements
3. **Prioritized Recommendations**: Rank gaps by impact on candidacy (critical → nice-to-have)
4. **Actionable Upskilling Plan**: Provide specific resources and learning paths for each gap

### Success Metrics

| Metric | Target | Measurement |
|-------|--------|-------------|
| **Gap Accuracy** | > 85% user validation | Post-analysis user feedback |
| **Role Fit Score Correlation** | > 0.7 with actual interview outcomes | Follow-up survey |
| **Upskilling Plan Adoption** | > 50% users start recommended learning | PostHog tracking |
| **Response Time** | < 3 seconds | P95 latency tracking |
| **Job Description Parsing** | > 90% successful extraction | Error rate monitoring |

---

## 🔄 Core User Flows

### Flow 1: Resume vs. Job Description Analysis
```
1. User has completed Resume Analyzer (has structured resume JSON)
2. User provides job description (paste text or URL)
3. Gap Finder Agent:
   - Parses job description (extract requirements, skills, experience)
   - Compares against resume JSON structure
   - Identifies missing technical skills
   - Identifies missing soft skills
   - Identifies missing experience/qualifications
   - Calculates role fit score (0-100)
4. Display gap analysis dashboard:
   - Role fit score with visual indicator
   - Missing skills (categorized, prioritized)
   - Missing experience (blockers vs. nice-to-have)
   - Prioritized upskilling plan with resources
   - Overall recommendation (apply now, upskill first, not a fit)
```

### Flow 2: Multi-Job Comparison
```
1. User analyzes resume against multiple job descriptions
2. System compares gap analyses across jobs
3. Shows:
   - Common missing skills across all roles
   - Role-specific gaps
   - Best-fit role recommendation
   - Consolidated upskilling plan
```

### Flow 3: Iterative Improvement Tracking
```
1. User upskills based on recommendations
2. Updates resume with new skills/experience
3. Re-runs gap analysis on same job description
4. Shows improvement metrics:
   - Role fit score delta (+/-)
   - Skills gap reduction
   - Updated upskilling priorities
```

---

## 🔑 Key Requirements

### Functional Requirements

#### FR1: Job Description Parsing
- **REQ-1.1**: Parse job description text (extract requirements, skills, qualifications)
- **REQ-1.2**: Support URL input (scrape job posting from LinkedIn, Indeed, etc.)
- **REQ-1.3**: Extract structured data (required skills, nice-to-have, experience level, qualifications)
- **REQ-1.4**: Handle various job description formats and structures

#### FR2: Gap Analysis
- **REQ-2.1**: Compare resume JSON against job requirements
- **REQ-2.2**: Identify missing technical skills (with confidence level)
- **REQ-2.3**: Identify missing soft skills
- **REQ-2.4**: Identify missing experience/qualifications
- **REQ-2.5**: Calculate role fit score (0-100) with breakdown

#### FR3: Prioritization Engine
- **REQ-3.1**: Rank gaps by impact on candidacy (critical → nice-to-have)
- **REQ-3.2**: Distinguish blockers from nice-to-haves
- **REQ-3.3**: Provide reasoning for each gap priority
- **REQ-3.4**: Consider skill dependencies (e.g., need X before Y)

#### FR4: Upskilling Recommendations
- **REQ-4.1**: Generate prioritized upskilling plan
- **REQ-4.2**: Provide specific learning resources (courses, tutorials, projects)
- **REQ-4.3**: Estimate time to close each gap
- **REQ-4.4**: Suggest portfolio projects to demonstrate skills

### Non-Functional Requirements

#### NFR1: Performance
- **NFR-1.1**: Analysis completes in < 3 seconds (P95)
- **NFR-1.2**: Support concurrent analyses (20+ users)
- **NFR-1.3**: Handle job descriptions up to 5000 words

#### NFR2: Accuracy
- **NFR-2.1**: > 85% gap identification accuracy (validated by users)
- **NFR-2.2**: Role fit score within ±10 points of actual interview outcomes
- **NFR-2.3**: < 5% false positive gaps (skills incorrectly identified as missing)

#### NFR3: Reliability
- **NFR-3.1**: 99.5% uptime
- **NFR-3.2**: Graceful handling of malformed job descriptions
- **NFR-3.3**: Retry logic for URL scraping failures

---

## 🛠️ Technical Approach

### Architecture Overview

```
┌─────────────────┐
│  Next.js UI     │  (shadcn/ui components)
└────────┬────────┘
         │
┌────────▼────────┐
│  API Route      │  /api/agents/gap
│  (route.ts)     │
└────────┬────────┘
         │
┌────────▼──────────────────────────────┐
│  LangGraph Agent                      │
│  ┌──────────────────────────────────┐ │
│  │  Gap Finder Node                 │ │
│  │  - Job description parsing        │ │
│  │  - Resume JSON comparison         │ │
│  │  - Gap identification             │ │
│  │  - Role fit scoring               │ │
│  │  - Prioritization logic           │ │
│  └──────────────────────────────────┘ │
└────────┬──────────────────────────────┘
         │
┌────────▼────────┐      ┌──────────────┐
│  Supabase RAG   │◄─────│  Job Desc    │
│  (optional)     │      │  Storage     │
└─────────────────┘      └──────────────┘
```

### Key Technical Components

#### 1. **LangGraph Node Implementation**
- **Location**: `lib/agents/gap-finder/node.ts`
- **Node Type**: Analysis node (no tool-calling needed)
- **Input State**: 
  ```typescript
  {
    resumeAnalysis: ResumeAnalysis;  // From Resume Analyzer
    jobDescription: string;          // Raw text or URL
  }
  ```
- **Output State**: 
  ```typescript
  {
    gapAnalysis: GapAnalysis;       // Structured gap analysis
  }
  ```
- **Processing**:
  - Parse job description (extract requirements)
  - Compare against resume JSON structure
  - Identify gaps using LLM reasoning
  - Calculate role fit score
  - Prioritize gaps by impact

#### 2. **RAG for Job Description (Optional Enhancement)**
- **Purpose**: Store and retrieve similar job descriptions for context
- **Implementation**: 
  - Embed job descriptions in Supabase VectorStore
  - Retrieve similar job postings for better understanding
  - Use industry-standard requirements as reference
- **Chunking**: By section (requirements, qualifications, responsibilities)
- **Retrieval**: Top-K similar jobs for context enhancement

#### 3. **Comparison Logic**
- **Skill Matching**: 
  - Exact match (skill name)
  - Semantic similarity (using embeddings)
  - Category matching (e.g., "React" matches "Frontend frameworks")
- **Experience Matching**:
  - Years of experience comparison
  - Role level matching (entry, mid, senior)
  - Industry/domain relevance
- **Gap Identification**:
  - Missing skills (not in resume but in job)
  - Missing experience (qualifications not met)
  - Missing soft skills (mentioned in job but not evident)

#### 4. **Role Fit Scoring Algorithm**
```
Base Score = 100

For each required skill:
  - If present: +5 points
  - If missing: -10 points

For each nice-to-have skill:
  - If present: +2 points
  - If missing: -1 point

For experience level:
  - Match: +20 points
  - One level off: +10 points
  - Two+ levels off: -20 points

For qualifications:
  - Match: +15 points
  - Missing: -15 points

Final Score = min(100, max(0, Base Score + adjustments))
```

#### 5. **State Management**
- **LangGraph State**: Centralized agent state
- **API State**: Request/response handling
- **UI State**: Analysis results display
- **PostHog Events**: Gap analysis tracking

#### 6. **Error Handling**
- **Try-catch blocks** around all async operations
- **Validation** for job description format
- **Fallback parsing** for malformed job descriptions
- **User-friendly error messages** via toast notifications
- **Sentry integration** for error tracking

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Agent Framework** | LangGraph | Multi-agent orchestration |
| **LLM** | OpenAI GPT-4o | Gap analysis and reasoning |
| **Vector DB** | Supabase (pgvector) | Optional job description RAG |
| **Embeddings** | OpenAI `text-embedding-3-small` | Semantic skill matching |
| **Frontend** | Next.js 16 App Router | UI rendering |
| **UI Components** | shadcn/ui | Design system |
| **Analytics** | PostHog | User tracking |
| **Error Tracking** | Sentry | Error monitoring |

---

## 🚫 Out of Scope

### Phase 1 Exclusions
- ❌ Automated job board scraping (manual URL input only)
- ❌ Real-time job market analysis
- ❌ Salary range gap analysis
- ❌ Company culture fit analysis
- ❌ Interview question generation based on gaps
- ❌ Automated resume optimization suggestions
- ❌ Multi-resume comparison (single resume only)

### Future Considerations
- 🔮 Integration with job boards (LinkedIn, Indeed API)
- 🔮 Industry-specific gap analysis templates
- 🔮 Learning path recommendations with time estimates
- 🔮 Portfolio project suggestions based on gaps
- 🔮 Mock interview questions targeting identified gaps
- 🔮 Salary negotiation guidance based on role fit

---

## ❓ Open Questions & Risks

### Open Questions

| Question | Impact | Resolution Needed By |
|----------|--------|---------------------|
| Should we cache job description embeddings? | Medium (cost optimization) | Before launch |
| How do we handle job descriptions in different languages? | Low (Phase 1 English only) | Phase 2 |
| Should role fit score be explainable (breakdown)? | High (user trust) | Week 1 |
| Do we need rate limiting for gap analysis API? | High (cost control) | Before launch |
| Should we store gap analyses for comparison over time? | Medium (feature value) | Week 2 |

### Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|------------|
| **LLM hallucination (false gaps)** | Medium | High | Validation prompts, confidence scores, user feedback loop |
| **Job description parsing errors** | Medium | Medium | Multiple parsing strategies, fallback to raw text analysis |
| **Role fit score inaccuracy** | Low | High | Calibration with user feedback, A/B testing different algorithms |
| **OpenAI API rate limits** | Medium | High | Implement queue system, caching, rate limiting |
| **Cost scaling with GPT-4o** | High | Medium | Use GPT-4o-mini for simple cases, GPT-4o only for complex analysis |

---

## 📋 Implementation Task List

### Phase 1: Setup & Schema

- [ ] **Task 1.1**: Create GapAnalysis Zod schema
  - **File**: `lib/agents/gap-finder/schema.ts`
  - **Time**: 30 min
  - **Details**: 
    - Define GapAnalysisSchema with all fields
    - Export TypeScript type
    - Add validation rules

- [ ] **Task 1.2**: Create gap-finder LangGraph node
  - **File**: `lib/agents/gap-finder/node.ts`
  - **Time**: 1.5 hours
  - **Details**:
    - Initialize ChatOpenAI (GPT-4o)
    - Implement `findGaps()` function
    - Create comparison prompt template
    - Use structured output for JSON schema
    - Error handling

### Phase 2: API Integration

- [ ] **Task 2.1**: Create gap analysis API endpoint
  - **File**: `app/api/agents/gap/route.ts`
  - **Time**: 1 hour
  - **Details**:
    - POST endpoint for gap analysis
    - Validate resumeAnalysis and jobDescription
    - Invoke gap-finder node
    - Return gap analysis JSON
    - Error handling and status codes

- [ ] **Task 2.2**: Add job description URL parsing (optional)
  - **File**: `lib/job-parser.ts`
  - **Time**: 1.5 hours
  - **Details**:
    - URL validation
    - Web scraping utility
    - Text extraction and cleaning
    - Fallback to manual input

### Phase 3: Graph Integration

- [ ] **Task 3.1**: Add gap_finder node to LangGraph
  - **File**: `lib/graph.ts`
  - **Time**: 30 min
  - **Details**:
    - Import findGaps function
    - Add gap_finder node to graph
    - Define state channels (resumeAnalysis, jobDescription, gapAnalysis)
    - Add edges from resume_analyzer to gap_finder

- [ ] **Task 3.2**: Update graph state schema
  - **File**: `lib/graph.ts`
  - **Time**: 30 min
  - **Details**:
    - Add gapAnalysis to state channels
    - Ensure proper state flow
    - Add conditional routing logic

### Phase 4: UI Components

- [ ] **Task 4.1**: Create job description input component
  - **File**: `components/job-description-input.tsx`
  - **Time**: 1 hour
  - **Details**:
    - Textarea for job description
    - URL input option
    - Paste detection
    - Character count
    - Validation feedback

- [ ] **Task 4.2**: Build gap analysis results display
  - **File**: `components/gap-analysis-results.tsx`
  - **Time**: 2 hours
  - **Details**:
    - Role fit score visualization (circular progress, color coding)
    - Missing skills list (categorized, prioritized)
    - Missing experience section
    - Prioritized upskilling plan with resources
    - Overall recommendation card
    - Expandable sections
    - Responsive design

- [ ] **Task 4.3**: Create gap comparison view (multi-job)
  - **File**: `components/gap-comparison.tsx`
  - **Time**: 1.5 hours
  - **Details**:
    - Side-by-side gap comparison
    - Common gaps highlighting
    - Best-fit role recommendation
    - Consolidated upskilling plan

### Phase 5: Enhancement & Polish

- [ ] **Task 5.1**: Add PostHog event tracking
  - **File**: `lib/analytics.ts`
  - **Time**: 30 min
  - **Details**:
    - Track gap analysis completion
    - Track role fit scores
    - Track upskilling plan views
    - User properties (avg role fit, gap count)

- [ ] **Task 5.2**: Implement job description caching
  - **File**: `lib/job-cache.ts`
  - **Time**: 1 hour
  - **Details**:
    - Cache parsed job descriptions
    - Cache embeddings for similar job retrieval
    - TTL management
    - Cache invalidation

- [ ] **Task 5.3**: Add error boundaries and loading states
  - **Files**: Multiple component files
  - **Time**: 45 min
  - **Details**:
    - Skeleton loaders for analysis
    - Error boundaries for API failures
    - Retry mechanisms
    - User-friendly error messages

### Phase 6: Testing

- [ ] **Task 6.1**: Write unit tests for gap-finder node
  - **File**: `__tests__/gap-finder.test.ts`
  - **Time**: 1.5 hours
  - **Details**:
    - Test gap identification accuracy
    - Test role fit score calculation
    - Test prioritization logic
    - Mock LLM responses

- [ ] **Task 6.2**: Write integration tests for API endpoint
  - **File**: `__tests__/api/gap.test.ts`
  - **Time**: 1 hour
  - **Details**:
    - Test POST endpoint
    - Test validation
    - Test error handling
    - Mock gap-finder node

---

**📅 Created**: 2025-01-27  
**👤 Author**: AI Career Coach Development Team  
**📌 Status**: Ready for Implementation

