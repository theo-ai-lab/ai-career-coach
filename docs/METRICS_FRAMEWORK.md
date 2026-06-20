# Metrics Framework — AI Career Coach

**Status:** Defined; baselines/targets **pending real traffic** · **Last updated:** 2026-06-18
**Scope:** the chat answer path (`/api/query`) and the report path (`/api/agents/report`).

> **Read this first — what is and isn't real here.**
> - The **signals** this framework measures are *real and produced today*: every one maps to a field the live `/api/query` route already returns (`app/api/query/route.ts:416-429`) and the UI already consumes (`app/page.tsx:34-73`).
> - The **PostHog event taxonomy** below is a *specification to wire on top of the existing provider*. PostHog is initialized (`app/providers.tsx`) — gated on `NEXT_PUBLIC_POSTHOG_KEY`, `person_profiles: 'identified_only'` — but the custom events named here are **not yet emitted**; wiring them is a tracked task (see [ROADMAP.md](ROADMAP.md)). Each event maps to a signal that already exists, so this is instrumentation, not new product behavior.
> - **Every baseline and target is "pending real traffic."** The early-2026 pilot's analytics are no longer accessible ([README](../README.md)). The only committed number is the red-team QA sample, labelled as such below.
> - **"Users" today are résumé-keyed, not auth'd.** `userId` is aliased to `resumeId` (`route.ts:99-105`); there is no auth. Treat every per-user metric as per-résumé until identity ships ([ROADMAP.md](ROADMAP.md)).

Companion docs: [PRD.md](PRD.md) (the capability these metrics measure) · [ROADMAP.md](ROADMAP.md) · [EVAL_DESIGN.md](EVAL_DESIGN.md) (the rubric behind the quality scores).

---

## 1. North-star metric

**Trustworthy Answer Rate (TAR)** — of all answered queries, the share that are *trustworthy by construction*:

```
TAR =  answers where  satisficing.meetsQualityBar == true
                 AND  grounding.status == "clean"        (semantic judge ran)
                 AND  region != "sparse"
       ────────────────────────────────────────────────────────────────────
                 all answered queries (answer returned, not 503 / not "no experience")
```

Why this and not "answers delivered" or a satisfaction score:
- It is **honest**: it only counts `clean` grounding when the semantic judge actually ran (`grounding/index.ts:138-145`), so it can't be inflated by a `deterministic-only` pass.
- It is **on-thesis**: it directly rewards the behavior the red-team showed was missing — grounded, non-sparse, quality-cleared answers — instead of fluency.
- It is **operator-actionable**: every term is a field already in the payload, so the metric decomposes straight into the funnel below.

**Target: pending real traffic.** (Direction: up. The denominator excludes honest non-answers — sparse no-doc states and 503s — so TAR measures answer *quality*, not availability.)

---

## 2. The trust funnel

Each stage maps to a real signal field. Counts/rates are **pending real traffic**.

| Stage | Definition | Backing signal (real, today) |
|-------|-----------|------------------------------|
| **1. Resume uploaded** | A résumé is chunked, embedded, stored | `/api/upload` success |
| **2. Query submitted** | A non-empty query for a valid résumé | passes `route.ts:69-78` |
| **3. Served (not blocked)** | Not a `503` not-configured, not an input reject | `route.ts:86-93` |
| **4. Answered (had evidence)** | Documents retrieved; a real answer generated | not the no-doc state `route.ts:199-222` |
| **5. Quality-cleared** | Answer cleared the satisficing bar | `signals.satisficing.meetsQualityBar` (`route.ts:308`) |
| **6. Grounded** | Claims reconciled clean **with** the semantic judge | `signals.grounding.status == "clean"` (`route.ts:428`) |
| **7. Non-sparse** | Query landed in a supported region | `signals.region != "sparse"` (`route.ts:418`) |
| **→ Trustworthy answer** | Stages 5 ∧ 6 ∧ 7 | the TAR numerator |
| **8. Engaged** | ≥2 queries in a session | session-scoped event count |
| **9. Returned** | A later session for the same résumé | episodic memory exists (`lib/memory/episodic.ts`) |

Honest leak points (where users drop and *should*): a `503` at stage 3 (operator config gap), a `sparse`/no-doc state at stage 4 (thin résumé — correctly *not* answered confidently), and a `routeToHuman` escalation that has no reviewer to land on (stage 5/6 — the reviewer workflow is unbuilt, see [PRD.md](PRD.md) scope cuts).

---

## 3. Activation & retention

**Activation (per résumé):** uploaded a résumé **and** received ≥1 *trustworthy answer* (TAR numerator) within the first session.
- Rationale: a delivered answer isn't activation if it was sparse/ungrounded — that's the failure the product exists to prevent. Activation requires the trustworthy version of the core action.
- **Target: pending real traffic.**

**Retention (per résumé):** returns in a later session and submits ≥1 query.
- The episodic-memory layer (`session_memories`) is what makes a return session continuous, so retention is meaningful here even pre-auth.
- Caveat: until the `userId = resumeId` aliasing is fixed (`route.ts:99-105`), "return" is résumé-keyed; a user with two résumés counts twice. Marked for the identity work in [ROADMAP.md](ROADMAP.md).
- **Target: pending real traffic.**

**Guardrails (counter-metrics):**
- **Over-escalation rate** — share of `routeToHuman=true` answers a reviewer would deem unnecessary. Defined; **pending real traffic** *and* pending the reviewer workflow.
- **Honest-floor rate** — share of `503` + no-doc states. Want this *non-zero* (it means the system declines rather than fabricates) but trending down as config/corpus improve.
- **Cost per answered query** — mean LLM calls (happy path ≈ 2 by construction, `satisficing.ts:148-158`). **Pending real traffic** for the true distribution.

---

## 4. PostHog event taxonomy

Naming: `snake_case`, past-tense events. **Every property below is sourced from a field that already exists** — the citation is where it's produced. Events are **proposed instrumentation, not yet emitted** (the provider is wired; `posthog.capture(...)` calls are not). Emit server-side from `/api/query` where the signal is authoritative, except UI-only events (marked).

> PII note: never send résumé text, the query body, or `flagged[].claim` text to PostHog. Send IDs, enums, counts, and booleans only. The properties below are designed to be PII-free.

### `resume_uploaded`
Stage 1. Source: `/api/upload`.
| Property | Type | Source |
|---|---|---|
| `resume_id` | string (id) | upload result |
| `chunk_count` | int | chunks stored |

### `query_submitted`
Stage 2 (UI-emitted on send). Source: `app/page.tsx` submit handler.
| Property | Type | Source |
|---|---|---|
| `resume_id` | string | request |
| `session_id` | string | request / response `sessionId` |
| `skip_memory` | bool | request flag (`route.ts:66`) — distinguishes eval traffic |

### `answer_service_unavailable`
Stage 3 leak. Source: `route.ts:86-93`.
| Property | Type | Source |
|---|---|---|
| `missing_keys` | string[] | `config.missing` (key *names* only, never values) |

### `answer_returned`  ← the workhorse event
Stages 4-7 in one event. Source: the `signals`/`scores` payload (`route.ts:400-429`).
| Property | Type | Source field |
|---|---|---|
| `resume_id`, `session_id` | string | response |
| `had_evidence` | bool | not the no-doc path (`route.ts:199`) |
| `confidence` | float 0..1 | `signals.confidence` (`data-density.ts:87`) |
| `region` | enum `dense\|borderline\|sparse` | `signals.region` (`data-density.ts:59`) |
| `mean_similarity` | float | `signals.meanSimilarity` |
| `route_to_human` | bool | `signals.hitl.routeToHuman` (`route.ts:421-422`) |
| `hitl_triggers` | string[] | `signals.hitl.triggers` — values: `sparse-data-density`, `high-stakes-keyword`, `below-quality-bar`, `grounding-unsupported` (`data-density.ts:235`, `route.ts:397-398`) |
| `reretrieval_attempted` | bool | `signals.reretrieval.attempted` |
| `reretrieval_fired` | bool | `signals.reretrieval.fired` (`retrieval-pipeline.ts:64-68`) |
| `reretrieval_saved_call` | bool | `signals.reretrieval.savedCall` |
| `reretrieval_improved` | bool | `signals.reretrieval.improved` |
| `info_gain` | float\|null | `signals.reretrieval.infoGain` |
| `satisficing_iterations` | int | `signals.satisficing.iterations` |
| `satisficing_stop_reason` | enum | `satisfied\|diminishing-returns\|max-iterations\|continue` (`satisficing.ts:80-84`) |
| `meets_quality_bar` | bool | `signals.satisficing.meetsQualityBar` (`route.ts:308`) |
| `grounding_status` | enum | `flagged\|clean\|deterministic-only\|skipped\|unavailable` (`grounding/types.ts:88-93`) |
| `grounding_checked` | int | `signals.grounding.checked` |
| `grounding_unsupported` | int | `signals.grounding.unsupported` |
| `grounding_overclaim` | int | `signals.grounding.overclaim` |
| `grounding_judge_mode` | string\|null | `signals.grounding.judgeMode` |
| `score_overall` | int 0..100 | `scores.overall` |
| `score_actionability`/`_personalization`/`_honesty`/`_grounding` | int 1..5 | `scores.*` (`route.ts:408-414`) |
| `is_trustworthy` | bool (derived) | `meets_quality_bar ∧ grounding_status=='clean' ∧ region!='sparse'` — the TAR numerator |

### `review_recommended`
Fires when `route_to_human` is true (can be a property filter on `answer_returned`; broken out for funnel clarity).
| Property | Type | Source |
|---|---|---|
| `hitl_triggers` | string[] | as above |
| `grounding_status` | enum | as above |

### `grounding_flagged`
Fires when `grounding_status == "flagged"`. Source: `route.ts:395`, `grounding/index.ts:126-133`.
| Property | Type | Source |
|---|---|---|
| `unsupported_count` | int | `grounding.unsupported` |
| `overclaim_count` | int | `grounding.overclaim` |
| `flagged_statuses` | string[] | `flagged[].status` (the *enum*, never the claim text) |
| `judge_mode` | string\|null | `grounding.judgeMode` |

### `report_generated`
Orchestrator path. Source: `/api/agents/report` → `lib/report-graph.ts`.
| Property | Type | Source |
|---|---|---|
| `resume_id` | string | request |
| `ran_job_matching` | bool | conditional edge fired (`report-graph.ts:723-725`) |
| `section_scores` | object | per-section `*.overall` evals (`report-graph.ts:704-710`) |

### `answer_rated`  *(planned — no UI affordance yet)*
Reserved for explicit user feedback (thumbs/correction). **Not emittable today** — there is no rating control. Listed so the schema is reserved and the retention/satisfaction work has a home.

---

## 5. Dashboards (build order)

1. **Trust funnel** — stages 1-7 above; the single most important view. Slice by `region`, `grounding_status`, `hitl_triggers`. Exclude `skip_memory=true` (eval traffic).
2. **Escalation health** — `review_recommended` volume by trigger; `grounding_flagged` rate by `judge_mode`. Watch for over-escalation and for `unavailable`/`skipped` grounding (config gaps).
3. **Cost & efficiency** — `satisficing_iterations` distribution; `reretrieval_saved_call` rate (calls avoided) vs `reretrieval_fired ∧ improved` (calls that paid off).
4. **Activation/retention cohorts** — by upload week, résumé-keyed (caveat above).

All thresholds drawn on these dashboards are **unvalidated defaults** until calibrated; see [ROADMAP.md](ROADMAP.md) "Gated on the un-fakeable."

---

## 6. The one committed number, correctly labelled

The 2026-05-11 red-team ([`red-team-observations.md`](../data/eval-benchmark/red-team-observations.md)) ran 25 adversarial prompts against the then-live deployment. **All 25 returned HTTP 200** (`:8`). Manual severity tally (`:304-312`):

| Severity | none | minor | material | failed | total |
|---|---|---|---|---|---|
| Count | 5 | 5 | 9 | 6 | 25 |

**How to read this number:** it is a **QA sample** — one synthetic adversarial persona, one date, manual severity labels — used as the *design input* for the gates this framework measures. It is **not** a resolution rate, **not** a live metric, and **not** a measurement of the shipped gates (the gates were built afterward, in response to it). Notably `mr-02` (a clear false-confirmation) scored **85/100** from the in-app judge (`:208`) and `hu-04` ("Google.") scored **30/100** (`:120`) — the spread that motivated the independent grounding gate (R5 in [PRD.md](PRD.md)). Do not cite the 25-prompt tally as a product KPI.
