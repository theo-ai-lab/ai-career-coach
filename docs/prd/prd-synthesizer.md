# 🧬 Synthesizer Agent - Product Requirements Document

> **AI Career Coach Portfolio Project**  
> Orchestrates all agent outputs into a single canonical career report

---

## 🧩 Problem

Theo now has multiple specialized agents (resume analysis, gap analysis, cover letter, interview prep, strategy).  
Individually they are powerful, but:
- There is no single **source of truth** object that aggregates everything.
- It’s hard to generate final artifacts (like a PDF report) without one unified payload.

The Synthesizer Agent creates a strongly-typed, unified `CareerReport` object from all downstream agent outputs.

---

## 🎯 Goals

1. **Unify agent results** into a single object suitable for reporting, saving, and exporting.
2. **Make downstream renderers simple** (e.g., report generator, dashboards).
3. **Preserve type safety** by reusing existing Zod types for each agent.

---

## 🔄 Flows

### Flow – Build Unified Career Report
```
1. UI or LangGraph orchestration collects:
   - resumeAnalysis
   - gapAnalysis
   - coverLetter
   - interviewPrep
   - strategyPlan
2. Call synthesizeCareerReport(...) with those objects.
3. Receive a unified report payload:
   - generatedAt
   - candidate
   - targetCompany
   - nested agent outputs
4. Pass this object into the report generator API.
```

---

## 📌 Requirements

### Functional

- **FR-1**: Accept fully-typed inputs:
  - `ResumeAnalysis`, `GapAnalysis`, `CoverLetter`, `InterviewPrep`, `StrategyPlan`.
- **FR-2**: Return a plain JSON object with:
  - metadata: `generatedAt`, `candidate`, `targetCompany`.
  - nested copies of all input objects.
- **FR-3**: Never mutate incoming objects (pure function).

### Non-Functional

- **NFR-1**: Zero network calls; pure aggregation only.
- **NFR-2**: Small footprint so it can be reused on client or server easily.

---

## 🧱 Technical Approach

- File: `lib/agents/synthesizer/node.ts`.
- Implement `synthesizeCareerReport` as a pure function that:
  - Derives `targetCompany` from `coverLetter.company`.
  - Stamps `generatedAt` with `new Date().toISOString()`.
  - Returns a serializable object.
- This agent does **not** call LLMs or external APIs.

---

## 🚫 Out of Scope

- ❌ Persistence (saving reports to Supabase).
- ❌ Any formatting or markdown generation.
- ❌ Partial state handling (requires all inputs present).

---

## ⏱️ < 2 Hour Task List

- [ ] **SY‑1**: Implement `synthesizeCareerReport`  
  - **File**: `lib/agents/synthesizer/node.ts`  
  - **Time**: 20 min  
  - Import all relevant types and return unified object as described.


