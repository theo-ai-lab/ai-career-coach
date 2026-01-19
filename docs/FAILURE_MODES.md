# AI Career Coach - Failure Mode Catalog

This document catalogs ways the system can fail, their impact, likelihood, and mitigations. Essential for responsible AI product development.

---

## Failure Mode Categories

1. **Retrieval Failures** - RAG doesn't find relevant context
2. **Generation Failures** - LLM produces bad output
3. **Memory Failures** - Context lost or corrupted
4. **Safety Failures** - Harmful or inappropriate responses
5. **Integration Failures** - External services fail
6. **User Experience Failures** - Confusing or frustrating interactions

---

## Critical Failures (High Impact)

### F1: Hallucinated Credentials

**Description:** AI invents experience, skills, or achievements not in user's resume.

**Impact:** User puts false info on applications, loses job offers, damages reputation.

**Likelihood:** Medium (mitigated by grounding prompt)

**Detection:** 
- Grounding eval score <80
- Citation check fails
- User reports false claims

**Mitigation:** 
- Strict grounding prompt: "ONLY use information from the provided RESUME CONTEXT"
- Explicit anti-hallucination instructions in all agent prompts
- Evaluation framework tracks grounding scores
- Source citations in responses (planned)
- Cross-reference check between agents

**Status:** ✅ Mitigated (strict prompts + evaluation)

**Code References:**
- `app/api/query/route.ts` - Grounding prompt
- `app/api/agents/job-matcher/route.ts` - "CRITICAL GROUNDING RULES"
- `lib/evals/coaching-quality.ts` - Grounding dimension scoring

---

### F2: Harmful Career Advice

**Description:** AI recommends actions that damage user's career (quit without backup, burn bridges, illegal actions).

**Impact:** Severe - user's livelihood affected.

**Likelihood:** Low

**Detection:** 
- Safety eval flag
- Keyword triggers (quit, burn bridges, illegal)
- User feedback/reports

**Mitigation:** 
- Guardrails in system prompt: "Do not recommend quitting jobs, burning bridges, or illegal actions"
- HITL for major decisions (in progress)
- Escalation triggers for high-stakes topics
- Explicit "Won't Do" list in PRD

**Status:** ⚠️ Partially mitigated (HITL in progress)

**Code References:**
- `docs/PRD.md` - Guardrails section
- System prompts across agents

---

### F3: Confidentiality Breach

**Description:** AI reveals info from one user's resume to another user.

**Impact:** Severe - privacy violation, potential legal issues.

**Likelihood:** Low (user_id scoping)

**Detection:** 
- Cross-user retrieval in logs
- User reports seeing wrong resume data
- Database query audit

**Mitigation:** 
- `resume_id` filtering on all queries
- `user_id` scoping in metadata
- RLS policies in Supabase
- Separate `resume_id` per upload
- No shared context between users

**Status:** ✅ Mitigated

**Code References:**
- `app/api/query/route.ts` - Filters by `resume_id` in metadata
- `app/api/upload/route.ts` - Generates unique `resume_id` per upload
- `lib/rag.ts` - Filters documents by `resume_id`

---

### F4: Discrimination in Recommendations

**Description:** AI gives different quality advice based on protected characteristics inferred from resume.

**Impact:** Severe - ethical and legal issues.

**Likelihood:** Low (using general-purpose LLM)

**Detection:** 
- Bias audit across demographic segments
- Evaluation score disparities
- User reports

**Mitigation:** 
- Neutral prompts, no demographic-based logic
- Focus on skills/experience, not personal characteristics
- Regular bias audits (planned)
- Evaluation framework tracks consistency

**Status:** ⚠️ Needs systematic testing

**Code References:**
- All agent prompts focus on skills/experience
- No demographic inference in code

---

## High Impact Failures

### F5: Generic Advice (Not Personalized)

**Description:** AI gives advice that could apply to anyone, ignoring user's specific background.

**Impact:** High - no value over free tools, user loses trust.

**Likelihood:** Medium

**Detection:** 
- Personalization eval score <70
- User feedback ("this is generic")
- Comparison with ChatGPT responses

**Mitigation:** 
- Evaluation framework tracks personalization (1-5 scale)
- RAG retrieval ensures resume-specific context
- Memory system provides user profile context
- Prompt engineering: "Be specific to THIS user's resume"
- Reject low personalization scores in report generation

**Status:** ✅ Mitigated

**Code References:**
- `lib/evals/coaching-quality.ts` - Personalization dimension
- `app/api/query/route.ts` - Memory context injection
- `app/api/agents/report/route.ts` - Evaluates each section

---

### F6: Outdated Job Market Information

**Description:** AI gives advice based on old salary data, defunct companies, or outdated hiring practices.

**Impact:** High - user makes decisions on bad info.

**Likelihood:** Medium (LLM knowledge cutoff)

**Detection:** 
- User feedback
- Manual review of salary/company mentions
- Knowledge cutoff date in model

**Mitigation:** 
- Explicit knowledge cutoff disclaimer in prompts
- Suggest user verification for time-sensitive info
- Guardrail against specific salary numbers
- Provide frameworks instead of specific data

**Status:** ⚠️ Partially mitigated

**Code References:**
- `docs/PRD.md` - "Won't Do: Salary negotiation specific numbers"
- System prompts acknowledge knowledge cutoff

---

### F7: Overconfident Salary Recommendations

**Description:** AI gives specific salary numbers with false confidence.

**Impact:** High - user under/over-negotiates.

**Likelihood:** Medium

**Detection:** 
- Confidence score calibration
- User feedback on salary advice
- Manual review

**Mitigation:** 
- Guardrail against specific numbers in PRD
- Provide ranges and frameworks instead
- Explicit uncertainty acknowledgment
- Suggest research and verification

**Status:** ✅ Mitigated (guardrail in place)

**Code References:**
- `docs/PRD.md` - Guardrails section
- System prompts avoid specific salary numbers

---

### F8: Mental Health Crisis Missed

**Description:** User expresses burnout, depression, or crisis; AI continues normal coaching.

**Impact:** High - missed opportunity to help, potential harm.

**Likelihood:** Low

**Detection:** 
- Keyword triggers (burnout, depression, anxiety, crisis)
- Sentiment analysis in session summaries
- User reports

**Mitigation:** 
- Escalation triggers for mental health keywords (defined in PRD)
- Suggest professional resources
- HITL review for flagged sessions
- Session sentiment tracking in episodic memory

**Status:** ⚠️ Partially mitigated (triggers defined, not fully implemented)

**Code References:**
- `docs/PRD.md` - Escalation triggers section
- `lib/memory/episodic.ts` - Sentiment extraction in summaries

---

## Medium Impact Failures

### F9: Retrieval Returns Wrong Sections

**Description:** Vector search returns irrelevant resume chunks for query.

**Impact:** Medium - response quality degrades.

**Likelihood:** Medium

**Detection:** 
- Context relevance eval <70
- User feedback ("this doesn't match my question")
- Manual review of retrieved chunks

**Mitigation:** 
- Chunking optimization (1000 tokens, 200 overlap)
- Embedding model tuning (text-embedding-3-small)
- Top-k adjustment (6-12 chunks)
- Query embedding refinement
- Filter by `resume_id` to narrow scope

**Status:** ✅ Mitigated

**Code References:**
- `app/api/upload/route.ts` - Chunking strategy
- `app/api/query/route.ts` - Top-k retrieval
- `lib/rag.ts` - Resume filtering

---

### F10: Session Memory Not Retrieved

**Description:** Memory system fails, AI doesn't recall previous conversations.

**Impact:** Medium - user must repeat context, frustrating UX.

**Likelihood:** Low (graceful degradation)

**Detection:** 
- Memory retrieval logs
- User feedback ("you don't remember me")
- Database query failures

**Mitigation:** 
- Non-blocking retrieval (doesn't block response)
- Graceful degradation (empty context if fails)
- Try-catch around memory operations
- Logging for monitoring
- Fallback to stateless mode

**Status:** ✅ Mitigated

**Code References:**
- `app/api/query/route.ts` - Try-catch around `getMemoryContext()`
- `lib/memory/retrieval.ts` - Error handling
- Returns empty context on failure

---

### F11: Cover Letter Too Generic

**Description:** Generated cover letter doesn't reflect user's unique experience.

**Impact:** Medium - user sends weak application.

**Likelihood:** Medium

**Detection:** 
- Cover letter eval score <80
- User feedback
- Comparison with resume content

**Mitigation:** 
- Evaluation framework tracks personalization
- Grounding in resume analysis and gap analysis
- Explicit prompt: "Use specific projects and metrics from resume"
- Reject low scores in report generation

**Status:** ✅ Mitigated

**Code References:**
- `app/api/agents/report/route.ts` - Evaluates cover letter section
- `app/api/agents/cover-letter/route.ts` - Grounding prompt

---

### F12: Interview Answers Don't Match Resume

**Description:** Suggested interview answers reference experiences not in user's background.

**Impact:** Medium - user caught in inconsistency during interview.

**Likelihood:** Low

**Detection:** 
- Grounding eval
- Cross-reference check between interview prep and resume
- User feedback

**Mitigation:** 
- Strict grounding in resume analysis
- Citation requirement (planned)
- Cross-validation between agents
- Explicit prompt: "Only use experiences from resume analysis"

**Status:** ✅ Mitigated

**Code References:**
- `app/api/agents/interview-prep/route.ts` - Uses resume analysis
- `app/api/agents/report/route.ts` - Evaluates interview prep

---

### F13: 6-Month Plan Unrealistic

**Description:** Strategy plan has unrealistic timelines or unachievable goals.

**Impact:** Medium - user gets discouraged or wastes effort.

**Likelihood:** Medium

**Detection:** 
- Actionability eval <70
- User feedback ("this is impossible")
- Manual review of timelines

**Mitigation:** 
- Actionability scoring in evaluation
- Realistic constraint prompts
- Monthly breakdown with achievable actions
- Ground in gap analysis (not aspirational)

**Status:** ⚠️ Partially mitigated

**Code References:**
- `lib/evals/coaching-quality.ts` - Actionability dimension
- `app/api/agents/strategy/route.ts` - Strategy generation

---

## Lower Impact Failures

### F14: Slow Response Time

**Description:** Response takes >10 seconds, user abandons.

**Impact:** Low - UX frustration, not harmful.

**Likelihood:** Low (gpt-4o-mini is fast)

**Detection:** 
- Latency monitoring
- User feedback
- Performance metrics

**Mitigation:** 
- Model selection (gpt-4o-mini for speed)
- Non-blocking operations (memory, evaluation)
- Streaming responses (planned)
- Caching for common queries (planned)

**Status:** ✅ Acceptable

**Code References:**
- `lib/rag.ts` - Uses gpt-4o-mini
- `app/api/query/route.ts` - Non-blocking memory/eval

---

### F15: PDF Parsing Fails

**Description:** Resume PDF can't be parsed (scanned image, corrupted, unsupported format).

**Impact:** Low - user can retry with different format.

**Likelihood:** Low

**Detection:** 
- Upload error handling
- Empty text extraction
- User reports

**Mitigation:** 
- Error message with guidance
- Support for multiple formats (PDF, TXT)
- Clear error messages
- Retry mechanism

**Status:** ✅ Mitigated

**Code References:**
- `app/api/upload/route.ts` - Error handling for PDF parsing
- Validates text extraction before processing

---

### F16: Evaluation Service Down

**Description:** LLM-as-judge fails, no quality scores.

**Impact:** Low - responses still work, just not scored.

**Likelihood:** Low

**Detection:** 
- Eval error logs
- Missing scores in database
- Monitoring alerts

**Mitigation:** 
- Graceful degradation (responses sent without scores)
- Non-blocking evaluation
- Error logging
- Retry logic (planned)

**Status:** ✅ Mitigated

**Code References:**
- `app/api/agents/report/route.ts` - Try-catch around evaluation
- `app/api/evals/coaching-quality/route.ts` - Error handling

---

### F17: Report Download Fails

**Description:** Markdown report generation fails.

**Impact:** Low - user can retry.

**Likelihood:** Low

**Detection:** 
- Error handling
- User reports
- Response status codes

**Mitigation:** 
- Retry logic
- Clear error messages
- Fallback to partial report
- Error logging

**Status:** ✅ Mitigated

**Code References:**
- `app/api/agents/report/route.ts` - Error handling
- Try-catch around report generation

---

### F18: User Profile Not Saved

**Description:** Semantic memory write fails silently.

**Impact:** Low - next session doesn't have full context.

**Likelihood:** Low

**Detection:** 
- Database write logs
- Missing profile on next session
- User reports

**Mitigation:** 
- Fire-and-forget with logging
- Retry on next interaction
- Error logging for monitoring
- Graceful degradation (works without profile)

**Status:** ✅ Mitigated

**Code References:**
- `lib/memory/semantic.ts` - Error handling in `upsertUserProfile()`
- Logs failures but doesn't throw

---

### F19: Agent Handoff Confusion

**Description:** User unclear which agent produced which output.

**Impact:** Low - confusion but not harmful.

**Likelihood:** Medium

**Detection:** 
- User feedback
- UI confusion

**Mitigation:** 
- Agent attribution in UI (planned)
- Clear section headers in reports
- Separate API routes for clarity

**Status:** ⏳ In progress

**Code References:**
- Report sections clearly labeled
- Separate routes: `/api/agents/{agent-name}`

---

### F20: Inconsistent Advice Across Sessions

**Description:** AI gives contradictory advice in different sessions.

**Impact:** Medium - user confused about direction.

**Likelihood:** Low (memory helps)

**Detection:** 
- Longitudinal consistency check
- User feedback
- Session summary comparison

**Mitigation:** 
- Memory retrieval provides context
- Session summaries track decisions
- Consistent grounding in resume
- Reference previous conversations naturally

**Status:** ✅ Mitigated

**Code References:**
- `lib/memory/retrieval.ts` - Retrieves recent sessions
- `app/api/query/route.ts` - Injects session context

---

## Edge Cases

### F21: Non-English Resume

**Description:** User uploads resume in language model handles poorly.

**Impact:** Medium - poor quality responses.

**Likelihood:** Low

**Detection:** 
- Language detection
- Poor embedding quality
- User feedback

**Mitigation:** 
- Language detection (planned)
- Warning for non-English
- Support for common languages (planned)
- Fallback to English-only mode

**Status:** ❌ Not implemented

---

### F22: Extremely Long Resume

**Description:** Resume exceeds chunking/context limits (e.g., 50+ pages).

**Impact:** Low - some content not indexed.

**Likelihood:** Low

**Detection:** 
- Chunk count monitoring
- Large file size
- User reports missing content

**Mitigation:** 
- Warning for oversized documents
- Pagination/chunking handles large docs
- Limit on total chunks per resume (planned)
- User guidance on resume length

**Status:** ⚠️ Partial (chunking handles it, but no explicit limits)

**Code References:**
- `app/api/upload/route.ts` - Chunks all text, no explicit limit

---

### F23: Adversarial Prompts

**Description:** User tries to jailbreak or extract system prompts.

**Impact:** Low - system prompts not sensitive.

**Likelihood:** Low

**Detection:** 
- Prompt injection patterns
- Unusual user queries
- Response anomalies

**Mitigation:** 
- Input validation
- Prompt structure (system vs user separation)
- Basic injection detection
- Rate limiting (planned)

**Status:** ⚠️ Basic protection only

**Code References:**
- System prompts separated from user input
- No sensitive data in prompts

---

### F24: Vector Search Returns No Results

**Description:** No relevant chunks found for query (empty resume, query mismatch).

**Impact:** Medium - user gets "no relevant experience" message.

**Likelihood:** Low

**Detection:** 
- Empty results from `match_documents`
- User feedback

**Mitigation:** 
- Graceful error message
- Suggest re-uploading resume
- Fallback to general advice with disclaimer
- Query refinement suggestions

**Status:** ✅ Mitigated

**Code References:**
- `app/api/query/route.ts` - Handles empty results
- Returns "No relevant experience found" message

---

### F25: Session Summarization Fails

**Description:** Background session summarization fails silently.

**Impact:** Low - no episodic memory for that session.

**Likelihood:** Low

**Detection:** 
- Summarization error logs
- Missing session in memory
- Monitoring alerts

**Mitigation:** 
- Fire-and-forget with error logging
- Doesn't block user response
- Retry logic (planned)
- Monitoring for failure rate

**Status:** ✅ Mitigated

**Code References:**
- `lib/memory/episodic.ts` - Error handling in `summarizeSessionAsync()`
- Logs failures but doesn't throw

---

## Summary Matrix

| ID | Failure Mode | Impact | Likelihood | Status |
|----|--------------|--------|------------|--------|
| F1 | Hallucinated Credentials | Critical | Medium | ✅ |
| F2 | Harmful Career Advice | Critical | Low | ⚠️ |
| F3 | Confidentiality Breach | Critical | Low | ✅ |
| F4 | Discrimination | Critical | Low | ⚠️ |
| F5 | Generic Advice | High | Medium | ✅ |
| F6 | Outdated Info | High | Medium | ⚠️ |
| F7 | Overconfident Salary | High | Medium | ✅ |
| F8 | Mental Health Missed | High | Low | ⚠️ |
| F9 | Wrong Retrieval | Medium | Medium | ✅ |
| F10 | Memory Lost | Medium | Low | ✅ |
| F11 | Generic Cover Letter | Medium | Medium | ✅ |
| F12 | Interview Mismatch | Medium | Low | ✅ |
| F13 | Unrealistic Plan | Medium | Medium | ⚠️ |
| F14 | Slow Response Time | Low | Low | ✅ |
| F15 | PDF Parsing Fails | Low | Low | ✅ |
| F16 | Evaluation Service Down | Low | Low | ✅ |
| F17 | Report Download Fails | Low | Low | ✅ |
| F18 | User Profile Not Saved | Low | Low | ✅ |
| F19 | Agent Handoff Confusion | Low | Medium | ⏳ |
| F20 | Inconsistent Advice | Medium | Low | ✅ |
| F21 | Non-English Resume | Medium | Low | ❌ |
| F22 | Extremely Long Resume | Low | Low | ⚠️ |
| F23 | Adversarial Prompts | Low | Low | ⚠️ |
| F24 | No Search Results | Medium | Low | ✅ |
| F25 | Summarization Fails | Low | Low | ✅ |

**Legend:**
- ✅ = Fully mitigated
- ⚠️ = Partially mitigated
- ⏳ = In progress
- ❌ = Not implemented

---

## Monitoring & Alerting Plan

| Metric | Threshold | Alert | Action |
|--------|-----------|-------|--------|
| Grounding eval score | <80 | Slack notification | Review prompt, check retrieval |
| Personalization score | <70 | Dashboard flag | Improve RAG retrieval, prompt tuning |
| Response latency | >10s | Performance alert | Check model, optimize prompts |
| Memory retrieval failures | >5% | System alert | Check Supabase connection, RLS policies |
| Upload failures | >2% | System alert | Check PDF parsing, file size limits |
| Session summarization failures | >10% | System alert | Check LLM API, prompt issues |
| Hallucination reports | Any | Immediate alert | Review grounding prompts, add citations |
| Safety flag triggers | Any | Immediate alert | HITL review, escalate to human |
| Cross-user data access | Any | Critical alert | Security review, audit logs |

---

## Response Procedures

### Critical Failures (F1-F4)
1. **Immediate:** Disable affected feature if possible
2. **Within 1 hour:** Root cause analysis
3. **Within 24 hours:** Fix or mitigation deployed
4. **Within 1 week:** Post-mortem and prevention plan

### High Impact Failures (F5-F8)
1. **Within 4 hours:** Investigation started
2. **Within 48 hours:** Fix or mitigation deployed
3. **Within 1 week:** Monitoring improved

### Medium/Low Impact Failures (F9-F25)
1. **Within 1 week:** Investigation and fix
2. **Monitor:** Track frequency and impact
3. **Improve:** Iterative mitigation

---

## Testing & Validation

### Regular Testing
- **Weekly:** Sample audit of responses for grounding
- **Monthly:** Bias audit across demographic segments
- **Quarterly:** Full failure mode review
- **After major changes:** Re-test all mitigations

### Test Cases
1. Upload resume with false information → Verify AI doesn't invent more
2. Query about experience not in resume → Verify "insufficient data" response
3. Upload two different resumes → Verify no cross-contamination
4. Express mental health concerns → Verify escalation trigger
5. Request salary advice → Verify no specific numbers given

---

*Last updated: December 2024*  
*Review quarterly or after significant changes*  
*Next review: January 2025*











