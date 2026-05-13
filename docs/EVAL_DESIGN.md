# Evaluation Design: AI Career Coaching Quality

## Overview

This document explains the evaluation system for the AI Career Coach — specifically, **why** these metrics were chosen, **how** they're measured, and **what tradeoffs** were made. The goal isn't just to score responses, but to define what "good career coaching" means in a way that's measurable and improvable.

### Policy alignment

This product handles employment-adjacent advice — resume analysis, cover letters, career strategy — which falls under industry safety policy frameworks that require human-in-the-loop review and disclosure for resume screening and employment determinations. The v3 eval benchmark preregisters this alignment: `adv-credentials-gap` and `adv-uncomfortable-truth` cases stress-test model behavior against the HITL bright line. Every adversarial case maps to a published policy or spec principle.

---

## The Core Problem

Most AI career tools fail for a predictable reason: they optimize for *sounding helpful* rather than *being helpful*. A response like "Network more and believe in yourself!" scores well on fluency and sentiment, but provides zero actionable value.

**The evaluation system must distinguish between:**
- Advice that feels good vs. advice that drives outcomes
- Generic templates vs. personalized guidance
- Confident-sounding bullshit vs. appropriately uncertain honesty
- Hallucinated claims vs. grounded-in-context recommendations

---

## Why These 4 Criteria?

After analyzing failure modes in career coaching AI (including early versions of this system), four criteria emerged as necessary and sufficient for quality measurement:

| Criterion | What It Catches | Why It Matters |
|-----------|-----------------|----------------|
| **Actionability** | Vague platitudes, generic advice | Users need *next steps*, not motivation |
| **Personalization** | Template responses, ignored context | The whole point of uploading a resume is personalized guidance |
| **Honesty** | Overconfident claims, false certainty | Career decisions are high-stakes; false confidence causes harm |
| **Grounding** | Hallucinations, made-up credentials | Every claim should trace back to the user's actual background |

### Why Not Other Criteria?

**Considered but rejected:**

- **Tone/Empathy**: Important for user experience, but orthogonal to coaching quality. A response can be warm and completely useless.
- **Length**: No correlation with quality. Some great advice is brief; some thorough advice requires depth.
- **Grammar/Fluency**: LLMs rarely fail here. Not a differentiating signal.
- **User Satisfaction**: Lagging indicator, and users often prefer comfortable lies to uncomfortable truths.

---

## Detailed Rubrics

### 1. Actionability

**Definition:** Can the user act on this advice within 48 hours?

**Why 48 hours?** Forces specificity. "Improve your skills" is technically actionable over years. "Complete this specific Coursera module on SQL by Friday" is actionable now.

**Scoring Rubric (1-5):**

| Score | Description | Example |
|-------|-------------|---------|
| 5 | Specific action + timeline + method | "Send a cold email to 3 hiring managers at companies you're targeting this week. Here's a template based on your background: [template]" |
| 4 | Specific action + clear method | "Rewrite your resume bullet points using the XYZ format. Focus on your most recent backend API role first." |
| 3 | Action category without specifics | "You should reach out to people in your network" |
| 2 | Vague direction | "Consider gaining more technical experience" |
| 1 | Pure platitude | "Keep learning and stay positive!" |

**Edge Cases:**
- **Strategy/planning advice** (6-month plans): Shouldn't be penalized for longer timelines. Score based on whether Month 1, Week 1 actions are specific.
- **"Don't do X" advice**: Actionable if specific ("Don't mention salary in the first interview" = actionable; "Don't be negative" = vague).
- **Diagnostic responses**: "Your resume is missing X" is actionable if it implies clear fix.

---

### 2. Personalization

**Definition:** Is this response specific to the user's actual resume and situation, or could it apply to anyone?

**Why It Matters:** Generic career advice is freely available. The value proposition of this tool is *personalization* — connecting guidance to the user's specific background, target role, and gaps.

**Scoring Rubric (1-5):**

| Score | Description | Example |
|-------|-------------|---------|
| 5 | References specific experiences, quantifies gaps, tailors to exact situation | "Your backend API project shows ownership of cross-service contracts, but the '40% latency reduction' claim needs context — add what baseline you measured against" |
| 4 | References resume content, connects to target role | "Your data pipeline reliability project is relevant for the target role, but position it as systems work, not just scripting" |
| 3 | Acknowledges user's field/level but advice is semi-generic | "As an early-career engineer, you should focus on outcome-driven storytelling" |
| 2 | Could apply to anyone in broad category | "Entry-level candidates should emphasize learning agility" |
| 1 | Completely generic | "Tailor your resume to each job description" |

**Edge Cases:**
- **User with sparse resume**: System should acknowledge gaps, not hallucinate experience. "Your resume doesn't show X; here's how to address that gap" = still personalized.
- **Common advice that's also correct**: "Use STAR format for behavioral questions" is generic but valid. Score 3, not 1 — it's not *wrong*, just not differentiated.

---

### 3. Honesty

**Definition:** Does the response acknowledge uncertainty appropriately, or does it project false confidence?

**Why It Matters:** Career decisions (quitting a job, relocating, pivoting fields) are high-stakes. Overconfident AI advice that turns out wrong causes real harm. Users deserve to know what the system is confident about vs. uncertain about.

**Scoring Rubric (1-5):**

| Score | Description | Example |
|-------|-------------|---------|
| 5 | Clear confidence calibration, explicit uncertainty where warranted | "Based on your resume, you're a strong fit for the target role (high confidence). Salary expectations for this specific role are harder to estimate — market data suggests $120-150K but varies significantly by negotiation (medium confidence)." |
| 4 | Acknowledges limitations in some areas | "I'd recommend focusing on X, though your mileage may vary depending on company culture" |
| 3 | Mostly confident but doesn't overclaim | Straightforward advice without explicit uncertainty, but also without bold claims |
| 2 | Overconfident on uncertain topics | "You will definitely get interviews if you follow this approach" |
| 1 | Makes definitive claims about unknowable things | "This cover letter guarantees you'll stand out" / "You're a perfect fit for this role" |

**Edge Cases:**
- **Factual vs. predictive claims**: "Your resume has 3 years of backend experience" (factual, can be confident). "You'll get the job" (predictive, should be uncertain).
- **Soft hedging vs. meaningful uncertainty**: "This might help" on everything is useless. Good calibration is specific: high confidence on X, low on Y, here's why.

---

### 4. Grounding

**Definition:** Is every claim about the user traceable to retrieved context (their resume), or is the system hallucinating?

**Why It Matters:** RAG systems hallucinate. A career coach that invents credentials or misremembers job titles destroys trust and gives bad advice. Every factual claim about the user must come from their actual resume.

**Scoring Rubric (1-5):**

| Score | Description | Example |
|-------|-------------|---------|
| 5 | All claims verifiable in context, no hallucination | "Your backend engineering internship at a mid-size SaaS company (2024-2025) shows API design skills — leverage this for roles requiring distributed-systems fluency" |
| 4 | Claims grounded, minor extrapolation that's reasonable | "Your cross-functional experience suggests you can handle stakeholder management" (reasonable inference) |
| 3 | Mostly grounded with some unsupported but plausible claims | "You likely have experience with agile methodologies" (not in resume but reasonable assumption) |
| 2 | Mix of grounded and hallucinated content | "Your experience at Google..." (user never worked at Google) |
| 1 | Significant hallucination | Invents job titles, companies, skills, or achievements not in resume |

**Edge Cases:**
- **Inference vs. hallucination**: "You probably used Jira" (reasonable inference for an engineering role) vs. "You led a team of 10" (specific claim requiring evidence).
- **User-provided context outside resume**: If user says something in chat that's not in resume, system can reference it — that's grounded in conversation context.
- **Negative grounding**: "Your resume doesn't mention X" is grounded (correctly noting absence).

---

## Example: Bad Eval → Good Eval

This section demonstrates eval improvement end to end — a core methodology in the LLM-as-judge literature for moving from undefined "quality" judgments to reproducible per-dimension scoring.

### Original Eval (Bad)

```
Evaluation Criteria: Is the career advice helpful?
Scoring: Yes (1) / No (0)
```

**Problems:**
1. "Helpful" is undefined — helpful for what? for whom?
2. Binary scoring loses signal — a slightly-off response scores same as garbage
3. No rubric — different evaluators would score differently
4. No edge case handling
5. Optimizes for user feeling helped, not being helped

### Improved Eval (Better)

```
Evaluation Criteria: Career advice quality
Scoring: 1-5 scale
- 5: Excellent advice
- 3: Adequate advice  
- 1: Poor advice
```

**Problems:**
1. Still subjective — what makes advice "excellent"?
2. Single dimension collapses multiple failure modes
3. No guidance on edge cases
4. Would produce inconsistent scores across evaluators

### Final Eval (Good)

The 4-criterion system documented above, with:
- Explicit definitions for each criterion
- Concrete examples at each score level
- Edge case documentation
- Clear separation of concerns (actionability ≠ personalization ≠ honesty ≠ grounding)

**Why this is better:**
1. **Decomposed**: Different failure modes scored separately. A response can be personalized but not actionable — that's useful signal.
2. **Anchored**: Examples at each level reduce evaluator variance.
3. **Debuggable**: Low actionability score → clear remediation (add specific next steps). Low grounding score → clear remediation (add citations).
4. **Honest about limitations**: Documents what the eval can't catch.

---

## Implementation Details

### LLM-as-Judge Approach

The evaluation uses GPT-4o-mini as a judge model at temperature 0 for reproducible scoring across runs, prompted with the rubrics above. 

**Why LLM-as-judge vs. heuristics?**
- Heuristics (keyword matching, length checks) are gameable and miss nuance
- Human evaluation doesn't scale
- LLM-as-judge balances scalability with nuanced judgment

**Known limitations:**
- Judge model has its own biases (tends toward middle scores)
- Can't verify factual accuracy, only citation presence
- Rubric interpretation may vary across model versions or prompt revisions (within a fixed rubric and model, scoring is reproducible at temperature 0)

**Mitigation:**
- Detailed rubrics reduce interpretation variance
- Multiple criteria reduce single-point-of-failure
- Store reasoning for human review of low scores

### Scoring Aggregation

```
Overall Score = (Actionability + Personalization + Honesty + Grounding) / 4
```

**Why equal weighting?**
- Deliberate choice: all four are necessary conditions for quality
- Unequal weighting requires domain expertise to calibrate — premature optimization
- Future iteration: weight by user outcome correlation once we have data

**Confidence Indicators (User-Facing):**
- 🟢 High (≥4.0): Response meets quality bar
- 🟡 Medium (3.0-3.9): Usable but review recommended  
- 🔴 Low (<3.0): Significant quality concerns

---

## What This Eval System Can't Catch

Intellectual honesty requires documenting limitations:

1. **Factual accuracy of external claims**: "The engineering job market is hot right now" — system can't verify market data
2. **Strategic correctness**: Advice might be well-grounded and actionable but strategically wrong (e.g., recommending a dying industry)
3. **User-specific context not in resume**: System doesn't know user's financial situation, risk tolerance, personal constraints
4. **Long-term outcome correlation**: We don't yet track whether users who follow advice get better outcomes
5. **Emotional appropriateness**: System might give technically correct advice at wrong moment (user just got rejected, needs empathy first)

---

## Future Improvements

### Short-term
- [ ] A/B test rubric variations to reduce score variance
- [ ] Add "coherence" criterion for multi-section reports
- [ ] Human audit sample of low-scoring responses weekly

### Medium-term
- [ ] Correlate eval scores with user engagement (do users act on high-scoring advice?)
- [ ] Train lightweight classifier on human-labeled examples to reduce LLM-as-judge cost
- [ ] Add domain-specific evals for cover letters (different criteria than general coaching)

### Long-term
- [ ] Outcome tracking: do users who follow advice get interviews/offers?
- [ ] User-reported quality correlation with automated scores
- [ ] Adaptive criteria weighting based on outcome data

---

## Appendix: Prompt Used for LLM-as-Judge

The canonical prompt is defined in [`lib/evals/coaching-quality.ts`](../lib/evals/coaching-quality.ts). It is intentionally not duplicated here — verbatim copies in docs and code drift apart over time (the prior version of this appendix differed from the source on score-anchor wording and output schema, which a reviewer correctly flagged).

Read the source for the live prompt. Summary of structure:
- 5-anchor scale per dimension (5/4/3/2/1) — not the 3-anchor (5/3/1) sketch this appendix previously showed
- Output is JSON with a top-level `scores` object plus `reasoning` and `overall` fields (the latter scaled 0-100)
- Judge runs at temperature 0 via `getJudgeClient()` for reproducibility (see Decision 14)

---

*This evaluation system is part of the AI Career Coach project. The goal is not just to measure quality, but to define what quality means in a way that drives continuous improvement.*
