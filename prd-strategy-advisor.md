# 🧭 Strategy Advisor Agent - Product Requirements Document

> **AI Career Coach Portfolio Project**  
> Full-stack LangGraph multi-agent system with Supabase RAG

---

## 🧩 Problem

Even with a strong resume, cover letter, and interview prep, candidates like Theo often lack a **clear long‑term plan** for how to close gaps and position themselves for a dream AI APM role at a specific company.  
They:
- Bounce between tutorials and side projects with no coherent roadmap.
- Don’t know what to do *this week* vs *this month*.
- Struggle to align their efforts with what a target company actually values.

The Strategy Advisor Agent turns `resumeAnalysis`, `gapAnalysis`, and a `targetCompany` into a **6‑month, week‑by‑week roadmap** with milestones and resources.

---

## 🎯 Goals

1. **Actionable Roadmap**: Provide a 6‑month career plan broken into monthly focuses and weekly actions.
2. **Company‑Aligned Strategy**: Everything in the plan is explicitly oriented around the target company’s expectations for AI/APM talent.
3. **Gap‑Driven**: Leverage `gapAnalysis` to prioritize skills, projects, and experiences that matter most.
4. **Reusable Artifact**: Return a structured `StrategyPlan` JSON that can be rendered and iterated on in the UI.

---

## 🔄 Flows

### Flow 1 – Generate Initial 6‑Month Plan
```
1. User has:
   - resumeAnalysis JSON
   - gapAnalysis JSON
   - selected targetCompany (e.g., "OpenAI").
2. User clicks "Generate My 6-Month Plan → {company}".
3. Frontend POSTs to /api/agents/strategy with:
   - resumeAnalysis
   - gapAnalysis
   - targetCompany
4. API calls Strategy Advisor node.
5. LLM returns StrategyPlan JSON with:
   - sixMonthGoal
   - monthlyBreakdown[0..5] (month 1–6)
   - finalRecommendation.
6. UI renders the plan as a timeline / checklist.
```

### Flow 2 – Regenerate with Different Company
```
1. Keep same resumeAnalysis + gapAnalysis.
2. User switches targetCompany from "OpenAI" to "Anthropic".
3. Re-run /api/agents/strategy with new targetCompany.
4. Plan shifts milestones/resources to better match new company’s style and product focus.
```

---

## 📌 Requirements

### Functional

- **FR-1**: Accept `resumeAnalysis`, `gapAnalysis`, and `targetCompany` in the request body.
- **FR-2**: Generate a `StrategyPlan` with:
  - `targetCompany`: echoed from input.
  - `sixMonthGoal`: one clear high‑level outcome.
  - `monthlyBreakdown`: length 6, each with:
    - `month` (1–6),
    - `focus` (short description),
    - `keyMilestones[]`,
    - `weeklyActions[]`,
    - `resources[]` (courses, docs, project ideas).
  - `finalRecommendation`: summary of how to use the plan.
- **FR-3**: Ensure the plan references gaps and strengths implied by the analysis (e.g., missing PM experience, RAG depth, experimentation skills).
- **FR-4**: Output must validate against `StrategyPlanSchema` (no extra fields or malformed arrays).

### Non-Functional

- **NFR-1**: P95 latency < 7 seconds with GPT‑4o.
- **NFR-2**: Plan should be understandable and executable by an early‑career candidate.
- **NFR-3**: Language must be motivational but concrete (no vague “keep learning AI” steps).

---

## 🧱 Technical Approach

### LangGraph Node

- **Location**: `lib/agents/strategy-advisor/node.ts`
- **Input State**:
  ```ts
  {
    resumeAnalysis: any;
    gapAnalysis: any;
    targetCompany?: string;
  }
  ```
- **Output State**:
  ```ts
  { strategyPlan: StrategyPlan }
  ```
- Implementation:
  - Use `ChatOpenAI` (`gpt-4o`, `temperature: 0.3`) with `withStructuredOutput(StrategyPlanSchema)`.
  - Inject serialized `resumeAnalysis` and `gapAnalysis` into the prompt to ground the roadmap.
  - Emphasize long‑term planning and weak‑to‑strong progression over 6 months (skill building → projects → public proof → interview readiness).

### API Route

- **File**: `app/api/agents/strategy/route.ts`
- Body:
  ```json
  {
    "resumeAnalysis": { ... },
    "gapAnalysis": { ... },
    "targetCompany": "OpenAI"
  }
  ```
- Returns:
  ```json
  { "success": true, "plan": StrategyPlan }
  ```

### Graph Integration

- **File**: `lib/graph.ts`
- Add `strategy_advisor` node that:
  - Reads `resumeAnalysis`, `gapAnalysis`, and `targetCompany`.
  - Writes `strategyPlan` to state.
- Can be chained after gap analysis and before final report.

---

## 🚫 Out of Scope

- ❌ Real‑time calendar integration or reminders.
- ❌ Live tracking of completion (checklist functionality is UI/Phase 2).
- ❌ Multi‑company blended plan (single targetCompany per plan).
- ❌ Actual resource validation (links are suggestions, not verified).

---

## ⚠️ Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Overly generic weekly actions | Medium | Prompt for concrete, time‑bounded tasks (e.g., “Ship X by week 3”). |
| Unrealistic workload | High | Instruct model to assume ~10–12 hrs/week max. |
| Hallucinated experience | High | Require actions/milestones to build on current skills and stated gaps; never assume non‑existent experience. |
| JSON mismatch | High | Use `withStructuredOutput(StrategyPlanSchema)` and surfacing validation errors. |

---

## ⏱️ < 2 Hour Task List

- [ ] **SA‑1**: Create strategy plan schema  
  - **File**: `lib/agents/strategy-advisor/schema.ts`  
  - **Time**: 15 min  
  - Implement `StrategyPlanSchema` + `StrategyPlan` type.

- [ ] **SA‑2**: Implement `generateStrategy` helper  
  - **File**: `lib/agents/strategy-advisor/node.ts`  
  - **Time**: 35 min  
  - Use `ChatOpenAI` with `withStructuredOutput(StrategyPlanSchema)`; inject resume/gap JSON + targetCompany.

- [ ] **SA‑3**: Create API route  
  - **File**: `app/api/agents/strategy/route.ts`  
  - **Time**: 20 min  
  - Parse body, call `generateStrategy`, return `{ success, plan }`.

- [ ] **SA‑4**: Wire LangGraph node  
  - **File**: `lib/graph.ts`  
  - **Time**: 20 min  
  - Import `generateStrategy`, add `strategy_advisor` node, extend channels to include `strategyPlan`.

- [ ] **SA‑5**: Add UI trigger button  
  - **File**: `app/page.tsx`  
  - **Time**: 20 min  
  - Add “Generate My 6‑Month Plan → OpenAI” button that calls `/api/agents/strategy` and logs the plan.

- [ ] **SA‑6**: Smoke test end‑to‑end  
  - **Time**: 10 min  
  - Use small mocked `resumeAnalysis` / `gapAnalysis`, ensure the JSON has 6 months of breakdown and a clear final recommendation.


