# ✉️ Cover Letter Writer Agent - Product Requirements Document

> **AI Career Coach Portfolio Project**  
> Full-stack LangGraph multi-agent system with Supabase RAG

---

## 🎯 Problem & Persona

### Problem Statement
Even strong candidates struggle to translate their resume + target role fit into a compelling cover letter. Most online templates are generic, recruiter-fatiguing, and fail to clearly connect the candidate’s story, technical depth, and gaps to a specific company. This agent turns the structured insights from the Resume Analyzer + Gap Finder into a tailored, high-signal 4‑paragraph cover letter for a specific company.

### User Persona: **Theo – Ambitious AI Builder**
- **Background**: Early-career AI / full‑stack engineer with several portfolio projects
- **Pain Points**:
  - Knows their experience is strong, but can’t quickly craft a cover letter per company
  - Struggles to connect RAG/LangGraph projects to each company’s mission
  - Unsure how to acknowledge gaps without sounding weak
- **Goals**:
  - Generate a **company-specific** cover letter in < 30 seconds
  - Keep tone confident, technical, and warm (no generic fluff)
  - Explicitly address gaps with an upskilling narrative

---

## 🎯 Goals

1. **Turn analysis into narrative**: Convert `resumeAnalysis` + `gapAnalysis` into a compelling 4‑paragraph story.
2. **Company‑specific output**: Every letter must reference the target company by name + mission.
3. **Structured JSON output**: Return a strongly‑typed `CoverLetter` object for UI + future reuse.
4. **Consistent voice**: Maintain Theo’s portfolio‑friendly brand: confident, kind, technical.

**Success looks like**:
- Recruiters describe the letter as “specific, memorable, and clearly tailored”.
- Theo can generate 3–5 unique letters in a row without manual editing.

---

## 🔄 Flows

### Flow 1 – One‑Click Cover Letter from Existing Analysis
```
1. User has already run:
   - Resume Analyzer → resumeAnalysis JSON
   - Gap Finder → gapAnalysis JSON
2. User clicks "Generate Cover Letter for {Company}" in the UI.
3. Frontend POSTs to /api/agents/cover-letter with:
   - resumeAnalysis
   - gapAnalysis
   - company (string)
4. API calls cover-letter LangGraph node / helper.
5. LLM returns structured CoverLetter JSON.
6. UI:
   - Shows full markdown letter
   - Allows "Copy", "Download .md", and "Use in email" actions (future).
```

### Flow 2 – Regenerate with Different Company
```
1. User keeps same resumeAnalysis + gapAnalysis in memory.
2. User changes company input (e.g., "OpenAI" → "Anthropic").
3. Re-run /api/agents/cover-letter.
4. New CoverLetter JSON is rendered; user can compare versions.
```

---

## 🔑 Requirements

### Functional
- **FR-1**: Accept `resumeAnalysis`, `gapAnalysis`, and `company` in the API body.
- **FR-2**: Use a **4‑paragraph structure**:
  1. Hook about AI’s future + Theo’s role
  2. Story with 1–2 concrete projects (RAG, LangGraph, full‑stack AI apps)
  3. Bridge from current gaps → upskilling plan
  4. Close with clear call‑to‑action + gratitude
- **FR-3**: Return a `CoverLetter` object:
  - `company`, `letter` (markdown), `whyThisRole`, `whyThisCompany`, `closingCallToAction`.
- **FR-4**: Tone controls:
  - Confident, warm, technically literate but non‑jargony for recruiters.
- **FR-5**: Error handling:
  - If LLM fails, respond with `{ success: false, error }` and a friendly UI message.

### Non‑Functional
- **NFR-1**: P95 latency < 4s with GPT‑4o.
- **NFR-2**: Output must be valid JSON that matches Zod schema (no stray text).
- **NFR-3**: Safe content – no negative language about previous employers or companies.

---

## 🧠 Technical Approach

### LangGraph / Agent Design
- **Node Location**: `lib/agents/cover-letter/node.ts`
- **Input State**:
  ```ts
  {
    resumeAnalysis: ResumeAnalysis;
    gapAnalysis: GapAnalysis;
    targetCompany?: string;
  }
  ```
- **Output State**:
  ```ts
  { coverLetter: CoverLetter }
  ```
- **Implementation**:
  - Use `ChatOpenAI` (`gpt-4o`, `temperature: 0.3`) with `withStructuredOutput(CoverLetterSchema)`.
  - Prompt injects:
    - Summary + key projects from `resumeAnalysis`.
    - Top gaps + upskilling plan from `gapAnalysis`.
    - `company` name to ground the story.
  - Return typed `CoverLetter` JSON to the graph state.

### Prompting & Tone Control
- Single system prompt:
  - Identity: “world‑class AI career coach for Theo Bermudez (USC Business + AI ’24).”
  - Constraints:
    - Must follow 4‑paragraph structure.
    - Max ~500 words; no bullet lists.
    - No generic claims like “I am excited to apply to your company”; always mention specific mission / team type when possible.
- JSON‑only response enforced via `withStructuredOutput`.

### API Route
- **Path**: `app/api/agents/cover-letter/route.ts`
- Body:
  ```json
  {
    "resumeAnalysis": { ... },
    "gapAnalysis": { ... },
    "company": "OpenAI"
  }
  ```
- Returns:
  ```json
  { "success": true, "letter": CoverLetter }
  ```

### Graph Integration
- **File**: `lib/graph.ts`
- Add node:
  - `cover_letter_writer` that:
    - Reads `resumeAnalysis`, `gapAnalysis`, and `targetCompany`.
    - Writes `coverLetter` back to state.
- This can be composed later with other nodes (e.g., final report).

---

## 🚫 Out of Scope

- ❌ Applying directly to ATS / job boards.
- ❌ Multi‑page letters or separate versions per team.
- ❌ Company‑specific fact scraping from the web (Phase 2: RAG on company info).
- ❌ Non‑English letters (English‑only for now).

---

## ⚠️ Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Overly generic letters | Medium | Heavily constrain prompt with Theo‑specific context and examples |
| JSON schema mismatch | High | Use `withStructuredOutput(CoverLetterSchema)` and log validation errors |
| LLM hallucinating fake projects | High | Explicitly instruct model to **only** reference projects mentioned in resumeAnalysis |
| Cost if user spams regenerate | Medium | Add simple client‑side cool‑down in future |

---

## ⏱️ < 2 Hour Implementation Task List

> Focus is wiring a working v1 agent and API, not UI polish.

- [ ] **CL‑1**: Create cover letter schema  
  - **File**: `lib/agents/cover-letter/schema.ts`  
  - **Time**: 15 min  
  - Define Zod `CoverLetterSchema` + `CoverLetter` type.

- [ ] **CL‑2**: Implement `writeCoverLetter` LLM node  
  - **File**: `lib/agents/cover-letter/node.ts`  
  - **Time**: 35 min  
  - Use `ChatOpenAI` + `withStructuredOutput(CoverLetterSchema)` with prompt described above.

- [ ] **CL‑3**: Create API route  
  - **File**: `app/api/agents/cover-letter/route.ts`  
  - **Time**: 20 min  
  - Validate body, call `writeCoverLetter`, handle errors.

- [ ] **CL‑4**: Wire into LangGraph  
  - **File**: `lib/graph.ts`  
  - **Time**: 15 min  
  - Import `writeCoverLetter`, add `cover_letter_writer` node, update state to include `coverLetter`.

- [ ] **CL‑5**: Add UI trigger button  
  - **File**: `app/page.tsx`  
  - **Time**: 25 min  
  - Add “Generate Cover Letter for OpenAI” button that calls `/api/agents/cover-letter` and shows `letter.letter` in alert.

- [ ] **CL‑6**: Smoke test end‑to‑end  
  - **Time**: 10 min  
  - Use mock `resumeAnalysis` + `gapAnalysis` JSON in the request, confirm letter quality + JSON shape.


