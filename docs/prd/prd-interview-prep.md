# 🎤 Interview Prep Agent - Product Requirements Document

> **AI Career Coach Portfolio Project**  
> Full-stack LangGraph multi-agent system with Supabase RAG

---

## 🧩 Problem

Candidates like Theo can get great resumes and gap analyses, but still struggle when it’s time for live interviews.  
They:
- Don’t know which questions they’re *actually* going to get.
- Reuse generic answers that don’t showcase their AI work.
- Fail to turn gaps into a confident upskilling story.

The Interview Prep Agent turns `resumeAnalysis`, `gapAnalysis`, the target **job description**, and **company** into a focused 10‑question mock interview with high‑quality answers.

---

## 🎯 Goals

1. **Targeted practice**: Generate 10 questions (5 behavioral, 5 technical) that are truly aligned with the job + company.
2. **High-signal answers**: Answers must use Theo’s real experience from the analysis, not generic advice.
3. **Reusable artifact**: Output as a structured JSON object (`InterviewPrep`) that can be rendered in UI or exported.
4. **Portfolio-ready demo**: One click from the UI should produce a full mock interview session.

---

## 🔄 Flows

### Flow 1 – End-to-End Interview Prep
```
1. User has:
   - resumeAnalysis JSON from Resume Analyzer
   - gapAnalysis JSON from Gap Finder
   - jobDescription string
   - company string
2. User clicks "Generate Interview Prep for {company}" in the UI.
3. Frontend POSTs to /api/agents/interview-prep with:
   - resumeAnalysis
   - gapAnalysis
   - jobDescription
   - company
4. API calls Interview Prep LangGraph node / helper.
5. LLM returns structured InterviewPrep JSON.
6. UI renders:
   - 5 behavioral Q&A in STAR format
   - 5 technical Q&A grounded in Theo's AI projects
   - A mockInterviewSummary (how ready he is, what to fix).
```

### Flow 2 – Company Swap
```
1. Keep same resumeAnalysis + gapAnalysis + jobDescription.
2. User changes company from "OpenAI" → "Anthropic" and clicks generate again.
3. Same API, but with new company string.
4. Questions/answers adjust to reference the new company context.
```

---

## 📌 Requirements

### Functional

- **FR-1**: Accept `resumeAnalysis`, `gapAnalysis`, `jobDescription`, and `company` as input.
- **FR-2**: Produce **10 questions total**:
  - 5 behavioral (leadership, ownership, product sense, collaboration, resilience).
  - 5 technical (AI concepts, system design, RAG/LangGraph, experimentation, metrics).
- **FR-3**: Answers must:
  - For behavioral: strictly follow **STAR** (Situation, Task, Action, Result).
  - For technical: reference concrete projects (e.g., AI Career Coach, RAG pipelines, LangGraph agents).
- **FR-4**: Output must conform to `InterviewPrepSchema`:
  - `behavioral[]`, `technical[]`, `mockInterviewSummary`.
- **FR-5**: No hallucinated companies, degrees, or projects outside what could be inferred from `resumeAnalysis` + `gapAnalysis`.

### Non-Functional

- **NFR-1**: P95 latency < 6 seconds with GPT‑4o.
- **NFR-2**: JSON must be valid and schema-safe (enforced via `withStructuredOutput`).
- **NFR-3**: Tone must be supportive, specific, and non-generic.

---

## 🧱 Technical Approach

### LangGraph Node
- **Location**: `lib/agents/interview-prep/node.ts`
- **Input State**:
  ```ts
  {
    resumeAnalysis: any;
    gapAnalysis: any;
    jobDescription: string;
    targetCompany?: string;
  }
  ```
- **Output State**:
  ```ts
  { interviewPrep: InterviewPrep }
  ```
- Implement a helper function `generateInterviewPrep` that:
  - Uses `ChatOpenAI` (`gpt-4o`, `temperature: 0.2`).
  - Injects:
    - stringified `resumeAnalysis`
    - stringified `gapAnalysis`
    - `jobDescription`
    - `company`
  - Calls `withStructuredOutput(InterviewPrepSchema)` to guarantee valid JSON.

### API Route
- **File**: `app/api/agents/interview-prep/route.ts`
- Body:
  ```json
  {
    "resumeAnalysis": { ... },
    "gapAnalysis": { ... },
    "jobDescription": "text or summary",
    "company": "OpenAI"
  }
  ```
- Returns:
  ```json
  { "success": true, "prep": InterviewPrep }
  ```

### Graph Integration
- **File**: `lib/graph.ts`
- Add node `"interview_prep"`:
  - Reads `resumeAnalysis`, `gapAnalysis`, `jobDescription`, `targetCompany`.
  - Writes `interviewPrep` back to state.
- Allows future chaining into `finalReport` or separate “interview mode”.

---

## 🚫 Out of Scope

- ❌ Live interview simulation / voice interface.
- ❌ Company-specific scraping (no web calls for job posts).
-. ❌ Scheduling or calendaring.
- ❌ Non-English interviews (English only).

---

## ⚠️ Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Overly generic questions | Medium | Prompt with concrete job description + company + gaps; sample for specificity. |
| Hallucinated experiences | High | Explicitly instruct model to only use information from the provided JSON blobs. |
| JSON validation failures | High | Use `withStructuredOutput(InterviewPrepSchema)` and log / bubble a clear error. |
| Too-long answers | Medium | Add explicit word-count guidance in prompt. |

---

## ⏱️ < 2 Hour Task List

- [ ] **IP‑1**: Create interview prep schema  
  - **File**: `lib/agents/interview-prep/schema.ts`  
  - **Time**: 15 min  
  - Define `InterviewPrepSchema` + `InterviewPrep` type.

- [ ] **IP‑2**: Implement `generateInterviewPrep` helper  
  - **File**: `lib/agents/interview-prep/node.ts`  
  - **Time**: 35 min  
  - Use `ChatOpenAI` with `withStructuredOutput(InterviewPrepSchema)`; inject all four inputs into prompt.

- [ ] **IP‑3**: Create API route  
  - **File**: `app/api/agents/interview-prep/route.ts`  
  - **Time**: 20 min  
  - Parse and validate body, call `generateInterviewPrep`, return JSON.

- [ ] **IP‑4**: Wire LangGraph node  
  - **File**: `lib/graph.ts`  
  - **Time**: 20 min  
  - Import `generateInterviewPrep`, add `interview_prep` node, extend channels with `interviewPrep`.

- [ ] **IP‑5**: Add UI trigger button  
  - **File**: `app/page.tsx`  
  - **Time**: 20 min  
  - Add “Generate Interview Prep for OpenAI” button that hits `/api/agents/interview-prep` and logs `prep` to console.

- [ ] **IP‑6**: Smoke test end‑to‑end  
  - **Time**: 10 min  
  - Hard-code small `resumeAnalysis` / `gapAnalysis` objects and sample jobDescription, verify 10 Q&A + summary returned.


