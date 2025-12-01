# 📄 Resume Analyzer Agent - Product Requirements Document

> **AI Career Coach Portfolio Project**  
> Full-stack LangGraph multi-agent system with Supabase RAG

---

## 🎯 Problem & User Persona

### Problem Statement
Job seekers struggle to understand how their resume aligns with job descriptions, identify skill gaps, and receive actionable feedback to improve their candidacy. Manual resume analysis is time-consuming and subjective.

### User Persona: **Alex - The Career Transitioner**
- **Age**: 28-35
- **Background**: Software engineer looking to transition to AI/ML roles
- **Pain Points**:
  - Unsure if resume highlights relevant AI/ML experience
  - Doesn't know which skills to emphasize for different roles
  - Needs personalized feedback on resume strength
  - Wants to understand keyword optimization for ATS systems
- **Goals**:
  - Get instant, AI-powered resume analysis
  - Understand alignment with job descriptions
  - Receive specific, actionable improvement suggestions
  - Track resume quality over time

---

## 🎯 Goals & Success Metrics

### Primary Goals
1. **Instant Analysis**: Provide comprehensive resume analysis in < 5 seconds
2. **Actionable Insights**: Deliver specific, prioritized recommendations
3. **Job Alignment**: Enable users to compare resume against job descriptions
4. **Skill Gap Identification**: Highlight missing skills vs. target roles

### Success Metrics

| Metric | Target | Measurement |
|-------|--------|-------------|
| **Analysis Accuracy** | > 90% user satisfaction | Post-analysis survey |
| **Response Time** | < 5 seconds | P95 latency tracking |
| **Engagement Rate** | > 60% users run analysis weekly | PostHog analytics |
| **Improvement Adoption** | > 40% implement suggestions | Follow-up survey |
| **Error Rate** | < 2% failed analyses | Sentry error tracking |

---

## 🔄 Core User Flows

### Flow 1: Resume Upload & Initial Analysis
```
1. User uploads resume (PDF/TXT) via drag-and-drop
2. System extracts text and chunks content
3. Resume Analyzer Agent processes:
   - Skills extraction
   - Experience parsing
   - Education identification
   - Keyword analysis
4. Display analysis results with:
   - Strengths summary
   - Weaknesses identified
   - Overall score (0-100)
   - Top 5 improvement suggestions
```

### Flow 2: Job Description Comparison
```
1. User pastes job description
2. System embeds job description
3. Resume Analyzer Agent:
   - Computes similarity scores
   - Identifies matching skills
   - Highlights missing requirements
   - Generates alignment score
4. Display comparison dashboard:
   - Match percentage
   - Skill overlap visualization
   - Missing skills list
   - Tailored resume suggestions
```

### Flow 3: Iterative Improvement Tracking
```
1. User makes resume changes
2. Re-uploads updated resume
3. System compares against previous version
4. Shows improvement metrics:
   - Score delta (+/-)
   - New skills added
   - Enhanced sections
   - Remaining gaps
```

---

## 🔑 Key Requirements

### Functional Requirements

#### FR1: Resume Parsing
- **REQ-1.1**: Support PDF, TXT, DOCX formats
- **REQ-1.2**: Extract structured data (name, email, phone, skills, experience, education)
- **REQ-1.3**: Handle multi-page resumes
- **REQ-1.4**: Preserve formatting context (sections, dates, locations)

#### FR2: Analysis Capabilities
- **REQ-2.1**: Extract and categorize skills (technical, soft, domain-specific)
- **REQ-2.2**: Identify experience level (entry, mid, senior, executive)
- **REQ-2.3**: Calculate resume strength score (0-100)
- **REQ-2.4**: Detect common issues (typos, formatting, gaps, verbosity)

#### FR3: Job Description Matching
- **REQ-3.1**: Parse job description requirements
- **REQ-3.2**: Compute semantic similarity using embeddings
- **REQ-3.3**: Generate alignment score and gap analysis
- **REQ-3.4**: Provide role-specific recommendations

#### FR4: Recommendations Engine
- **REQ-4.1**: Prioritize suggestions (critical → nice-to-have)
- **REQ-4.2**: Provide specific, actionable recommendations
- **REQ-4.3**: Include examples and templates
- **REQ-4.4**: Track recommendation implementation

### Non-Functional Requirements

#### NFR1: Performance
- **NFR-1.1**: Analysis completes in < 5 seconds (P95)
- **NFR-1.2**: Support concurrent analyses (10+ users)
- **NFR-1.3**: Handle resumes up to 10 pages

#### NFR2: Reliability
- **NFR-2.1**: 99.5% uptime
- **NFR-2.2**: Graceful error handling with user-friendly messages
- **NFR-2.3**: Retry logic for transient failures

#### NFR3: Security & Privacy
- **NFR-3.1**: Encrypt resume data at rest (Supabase encryption)
- **NFR-3.2**: Secure file uploads (validation, sanitization)
- **NFR-3.3**: User data isolation (RLS policies)
- **NFR-3.4**: GDPR-compliant data handling

---

## 🛠️ Technical Approach

### Architecture Overview

```
┌─────────────────┐
│  Next.js UI     │  (shadcn/ui components)
└────────┬────────┘
         │
┌────────▼────────┐
│  API Route      │  /api/agents/resume
│  (route.ts)     │
└────────┬────────┘
         │
┌────────▼──────────────────────────────┐
│  LangGraph Agent                      │
│  ┌──────────────────────────────────┐ │
│  │  Resume Analyzer Node            │ │
│  │  - Text extraction               │ │
│  │  - Chunking (500 tokens)         │ │
│  │  - Embedding generation          │ │
│  │  - RAG retrieval                 │ │
│  │  - LLM analysis                  │ │
│  └──────────────────────────────────┘ │
└────────┬──────────────────────────────┘
         │
┌────────▼────────┐      ┌──────────────┐
│  Supabase RAG   │◄─────│  Vector Store│
│  (pgvector)     │      │  (1536 dims) │
└─────────────────┘      └──────────────┘
```

### Key Technical Components

#### 1. **LangGraph Node Implementation**
- **Location**: `lib/agents/resume-analyzer.ts`
- **Node Type**: Tool-calling agent node
- **State Schema**: 
  ```typescript
  {
    resumeText: string;
    chunks: string[];
    embeddings: number[][];
    analysis: ResumeAnalysis;
    recommendations: Recommendation[];
  }
  ```
- **Tools**: 
  - `extract_skills` - Parse skills from text
  - `calculate_score` - Compute resume strength
  - `compare_job_description` - Match against JD

#### 2. **Supabase Vector Store Integration**
- **Embedding Model**: `text-embedding-3-small` (1536 dimensions)
- **Chunking Strategy**: 
  - Semantic chunking by sections (Experience, Education, Skills)
  - Overlap: 50 tokens
  - Max chunk size: 500 tokens
  - Preserve section context in metadata
- **Retrieval Method**: 
  - Similarity search using cosine distance
  - Top-K retrieval (K=5) for context
  - Hybrid search (vector + keyword) for skills matching

#### 3. **State Management**
- **LangGraph State**: Centralized agent state
- **Supabase Storage**: Resume files and analysis history
- **React State**: UI state (Next.js App Router)
- **PostHog Events**: User interaction tracking

#### 4. **Error Handling**
- **Try-catch blocks** around all async operations
- **Retry logic** for OpenAI API calls (exponential backoff)
- **Validation** for file uploads (size, format, content)
- **User-friendly error messages** via toast notifications
- **Sentry integration** for error tracking

#### 5. **Data Flow**
```
1. User uploads resume → API route validates
2. Extract text → chunk by sections
3. Generate embeddings → store in Supabase
4. LangGraph node retrieves relevant context
5. LLM analyzes with context → generates insights
6. Store analysis in Supabase → return to UI
7. PostHog tracks event → display results
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Agent Framework** | LangGraph | Multi-agent orchestration |
| **Vector DB** | Supabase (pgvector) | RAG storage & retrieval |
| **Embeddings** | OpenAI `text-embedding-3-small` | Semantic search |
| **LLM** | OpenAI GPT-4o-mini | Analysis generation |
| **Frontend** | Next.js 16 App Router | UI rendering |
| **UI Components** | shadcn/ui | Design system |
| **Analytics** | PostHog | User tracking |
| **Error Tracking** | Sentry | Error monitoring |

---

## 🚫 Out of Scope

### Phase 1 Exclusions
- ❌ Resume template generation
- ❌ Multi-language support (English only)
- ❌ Real-time collaborative editing
- ❌ Integration with job boards (LinkedIn, Indeed)
- ❌ Automated resume optimization (A/B testing)
- ❌ Video resume analysis
- ❌ Cover letter generation
- ❌ Interview preparation features

### Future Considerations
- 🔮 Resume versioning and diff visualization
- 🔮 Industry-specific analysis templates
- 🔮 Integration with applicant tracking systems
- 🔮 AI-powered resume rewriting
- 🔮 Portfolio project suggestions based on gaps

---

## ❓ Open Questions & Risks

### Open Questions

| Question | Impact | Resolution Needed By |
|----------|--------|---------------------|
| Should we cache embeddings for re-analyzed resumes? | High (cost optimization) | Before launch |
| What's the optimal chunk size for resume sections? | Medium (accuracy) | During development |
| How do we handle resumes with images/tables? | Medium (parsing accuracy) | Week 1 |
| Should analysis be stored per user or per resume? | Low (data model) | Week 1 |
| Do we need rate limiting for analysis API? | High (cost control) | Before launch |

### Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|------------|
| **OpenAI API rate limits** | Medium | High | Implement queue system, caching |
| **Embedding cost scaling** | High | Medium | Cache embeddings, batch processing |
| **Parsing accuracy issues** | Medium | High | Multiple parsing strategies, fallbacks |
| **Vector DB performance** | Low | Medium | Index optimization, connection pooling |
| **User data privacy concerns** | Low | High | Clear privacy policy, encryption, RLS |

---

## 📋 Implementation Task List

### Phase 1: Setup & Infrastructure

- [ ] **Task 1.1**: Create Supabase table schema for resumes
  - **File**: `supabase/migrations/create_resumes_table.sql`
  - **Time**: 30 min
  - **Details**: 
    - `resumes` table (id, user_id, filename, text_content, created_at)
    - `resume_analyses` table (id, resume_id, score, analysis_json, created_at)
    - `resume_chunks` table (id, resume_id, chunk_text, embedding, metadata)
    - Enable pgvector extension
    - Create vector index on embeddings

- [ ] **Task 1.2**: Set up Supabase VectorStore utility
  - **File**: `lib/vector-store.ts`
  - **Time**: 45 min
  - **Details**:
    - Initialize Supabase client with vector support
    - Create `storeResumeChunks()` function
    - Create `retrieveSimilarChunks()` function
    - Add error handling and logging

- [ ] **Task 1.3**: Create resume upload API endpoint
  - **File**: `app/api/upload/resume/route.ts`
  - **Time**: 1 hour
  - **Details**:
    - Handle multipart/form-data file uploads
    - Validate file type (PDF, TXT, DOCX)
    - Validate file size (< 10MB)
    - Extract text using pdf-parse or mammoth
    - Store file in Supabase Storage
    - Return resume ID

### Phase 2: Text Processing & Chunking

- [ ] **Task 2.1**: Implement resume text extraction utility
  - **File**: `lib/resume-parser.ts`
  - **Time**: 1.5 hours
  - **Details**:
    - PDF parsing with pdf-parse
    - DOCX parsing with mammoth
    - Text cleaning and normalization
    - Section detection (Experience, Education, Skills, etc.)
    - Return structured resume object

- [ ] **Task 2.2**: Create semantic chunking function
  - **File**: `lib/chunking.ts`
  - **Time**: 1 hour
  - **Details**:
    - Split by sections (preserve context)
    - Chunk size: 500 tokens max
    - Overlap: 50 tokens
    - Add metadata (section_type, resume_id, chunk_index)
    - Return chunk array with metadata

- [ ] **Task 2.3**: Build embedding generation service
  - **File**: `lib/embeddings.ts`
  - **Time**: 45 min
  - **Details**:
    - OpenAI embeddings client setup
    - `generateEmbeddings()` function (batch processing)
    - Model: `text-embedding-3-small`
    - Error handling and retry logic
    - Rate limiting considerations

### Phase 3: LangGraph Agent Node

- [ ] **Task 3.1**: Define Resume Analyzer state schema
  - **File**: `lib/agents/types.ts`
  - **Time**: 30 min
  - **Details**:
    - TypeScript interfaces for ResumeAnalysis
    - State schema for LangGraph
    - Recommendation type definitions
    - Error state types

- [ ] **Task 3.2**: Create Resume Analyzer LangGraph node
  - **File**: `lib/agents/resume-analyzer.ts`
  - **Time**: 2 hours
  - **Details**:
    - Initialize LangGraph node
    - Implement `analyzeResumeNode()` function
    - RAG retrieval from Supabase VectorStore
    - LLM prompt engineering for analysis
    - Tool definitions (extract_skills, calculate_score)
    - State updates and error handling

- [ ] **Task 3.3**: Build analysis prompt templates
  - **File**: `lib/prompts/resume-analysis.ts`
  - **Time**: 1 hour
  - **Details**:
    - System prompt for resume analysis
    - User prompt template with resume context
    - Job description comparison prompt
    - Recommendation generation prompt
    - Few-shot examples for better accuracy

### Phase 4: API Integration

- [ ] **Task 4.1**: Create resume analysis API endpoint
  - **File**: `app/api/agents/resume/route.ts`
  - **Time**: 1.5 hours
  - **Details**:
    - POST endpoint for analysis request
    - Validate resume_id parameter
    - Load resume text from Supabase
    - Chunk and embed resume
    - Invoke LangGraph agent
    - Store analysis results
    - Return analysis JSON
    - Error handling and status codes

- [ ] **Task 4.2**: Add job description comparison endpoint
  - **File**: `app/api/agents/resume/compare/route.ts`
  - **Time**: 1 hour
  - **Details**:
    - POST endpoint with resume_id and job_description
    - Embed job description
    - Compute similarity scores
    - Generate alignment analysis
    - Return comparison results

- [ ] **Task 4.3**: Implement analysis history endpoint
  - **File**: `app/api/agents/resume/history/route.ts`
  - **Time**: 45 min
  - **Details**:
    - GET endpoint with user_id
    - Query Supabase for past analyses
    - Return analysis history with timestamps
    - Support pagination

### Phase 5: UI Components

- [ ] **Task 5.1**: Create resume upload component
  - **File**: `components/resume-upload.tsx`
  - **Time**: 1 hour
  - **Details**:
    - Drag-and-drop file upload (shadcn/ui)
    - File type validation
    - Upload progress indicator
    - Error toast notifications
    - Success callback with resume_id

- [ ] **Task 5.2**: Build analysis results display component
  - **File**: `components/resume-analysis-results.tsx`
  - **Time**: 1.5 hours
  - **Details**:
    - Score visualization (circular progress)
    - Strengths/weaknesses cards
    - Recommendations list with priorities
    - Expandable sections
    - Copy-to-clipboard for suggestions
    - Responsive design

- [ ] **Task 5.3**: Create job description comparison UI
  - **File**: `components/job-comparison.tsx`
  - **Time**: 1.5 hours
  - **Details**:
    - Textarea for job description input
    - Match percentage display
    - Skill overlap visualization (tags)
    - Missing skills list
    - Tailored recommendations section
    - Side-by-side comparison view

- [ ] **Task 5.4**: Build analysis history page
  - **File**: `app/analysis/history/page.tsx`
  - **Time**: 1 hour
  - **Details**:
    - List of past analyses
    - Score trends over time
    - Filter by date range
    - Link to detailed analysis view
    - Export analysis as PDF option

### Phase 6: Orchestration & Integration

- [ ] **Task 6.1**: Integrate Resume Analyzer into main LangGraph workflow
  - **File**: `lib/agents/workflow.ts`
  - **Time**: 1 hour
  - **Details**:
    - Add resume-analyzer node to graph
    - Define edges and conditional routing
    - Handle state transitions
    - Error recovery paths

- [ ] **Task 6.2**: Add PostHog event tracking
  - **File**: `lib/analytics.ts`
  - **Time**: 45 min
  - **Details**:
    - Track resume upload events
    - Track analysis completion
    - Track recommendation clicks
    - Track job comparison usage
    - User properties (resume score, improvement delta)

- [ ] **Task 6.3**: Set up error tracking with Sentry
  - **File**: `lib/error-handling.ts`
  - **Time**: 30 min
  - **Details**:
    - Sentry initialization
    - Error boundary for UI
    - API error logging
    - Context enrichment (user_id, resume_id)

### Phase 7: Testing & Polish

- [ ] **Task 7.1**: Write unit tests for resume parser
  - **File**: `__tests__/resume-parser.test.ts`
  - **Time**: 1 hour
  - **Details**:
    - Test PDF extraction
    - Test DOCX extraction
    - Test section detection
    - Test edge cases (empty files, corrupted files)

- [ ] **Task 7.2**: Write integration tests for API endpoints
  - **File**: `__tests__/api/resume.test.ts`
  - **Time**: 1.5 hours
  - **Details**:
    - Test upload endpoint
    - Test analysis endpoint
    - Test comparison endpoint
    - Mock Supabase and OpenAI calls

- [ ] **Task 7.3**: Add loading states and error boundaries
  - **Files**: Multiple component files
  - **Time**: 1 hour
  - **Details**:
    - Skeleton loaders for analysis
    - Error boundaries for API failures
    - Retry mechanisms in UI
    - User-friendly error messages

---

## 🚀 Deployment Commands

### Push PRD to Notion
```bash
# Using MCP Notion integration
@mcp notion-create-pages parent={"page_id":"YOUR_NOTION_PAGE_ID"} pages=[{"properties":{"title":"Resume Analyzer Agent PRD"},"content":"[paste markdown content]"}]
```

### Push PRD to Confluence (Alternative)
```bash
# Using MCP Atlassian integration
@mcp atlassian-createConfluencePage cloudId="theo-bermudez.atlassian.net" spaceId="YOUR_SPACE_ID" title="Resume Analyzer Agent PRD" body="[paste markdown content]"
```

---

**📅 Created**: 2025-01-27  
**👤 Author**: AI Career Coach Development Team  
**📌 Status**: Ready for Implementation

