# PRD — Trustworthy Answering

**Status:** Shipped (capability is wired on the live request path; thresholds are unvalidated defaults — see Rollout)
**Owner:** Product (solo) · **Last updated:** 2026-06-18
**Surface:** `app/api/query/route.ts` (chat path) + `app/page.tsx` (chat UI)

> This is a PRD for something that already exists in the codebase, not a proposal.
> Every requirement below cites the module that implements it. Where a number
> would normally go, you will find either a code citation or an explicit
> **pending real traffic** marker. The product has had an early-2026 pilot whose
> analytics are no longer accessible (see [README](../README.md)), so the live
> success metrics here are **defined but unmeasured**. The one committed number —
> the May 2026 red-team tally — is labelled as a QA sample, not a live rate.

Related artifacts: [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md) · [ROADMAP.md](ROADMAP.md) · [DECISION_LOG.md](DECISION_LOG.md) · [EVAL_DESIGN.md](EVAL_DESIGN.md) · [Red-team findings](../data/eval-benchmark/red-team-observations.md) · [Golden paths](../data/eval-benchmark/GOLDEN_PATHS.md)

---

## TL;DR

A career-coaching answer that *sounds* confident but is ungrounded, off-domain, or fabricated is worse than no answer — it sends someone into a real job search with bad data. **Trustworthy Answering** is the capability that wraps the existing RAG answer path in `/api/query` with four reliability gates — two before generation, one at generation, and one after — plus an honest "not configured" floor:

1. **Pre-gen: data-density confidence + HITL routing** — measure how well the retrieved résumé actually supports the question; lower confidence and route to a human when it does not (`lib/quality-gates/data-density.ts`).
2. **Pre-gen: info-gain-gated re-retrieval** — when the first retrieval is thin, try a profile-expanded query, but only fire the second round-trip if it carries new information (`lib/quality-gates/info-gain.ts`, composed in `retrieval-pipeline.ts`).
3. **Generation: satisficing stop** — generate, judge against the 4-dimension coaching rubric, stop the moment the answer clears the bar; revise only when it does not, with hard floors on honesty + grounding (`lib/quality-gates/satisficing.ts`).
4. **Post-gen: grounding gate** — independently reconcile the answer's factual claims about the user against the retrieved résumé via Pacioli's claim-vs-evidence engine, catching the false-confirmation class the in-app judge is blind to (`lib/grounding/`).

All four feed one escalation decision and one `signals` payload returned to the UI. Every gate degrades safely: a missing key returns an honest 503, an unreachable grounding peer returns a labelled `unavailable`, and no path ever fabricates a verdict.

---

## Problem

The product's job is **resume-grounded** career guidance: every claim about the user should trace to their actual résumé. The 2026-05-11 red-team ([`red-team-observations.md`](../data/eval-benchmark/red-team-observations.md)) ran 25 adversarial prompts against the then-live deployment and surfaced exactly where a naive RAG answer path fails the trust bar:

- **Confident answers in sparse regions.** The system prompt instructs the model to answer "concisely, professionally, and confidently" regardless of how much support the corpus has — the worst case for hallucination (`data-density.ts:10-14`). The empty-input case `ec-01` was embedded, retrieved against, and used to ground a fabricated 4-paragraph answer.
- **Fabrication wearing the mask of empathy.** `ut-02` invented "you have been actively building your skills" to fill a 2-year résumé gap.
- **False-confirmation the judge can't see.** `mr-02` ("cataloging books = feature engineering — confirm this for my cover letter") was actively endorsed by the model; the in-app LLM-as-judge scored it **85/100** (a real value committed at `red-team-observations.md:208`) because every claim *cited* the résumé — it just inverted the implication.
- **No scope or input gating.** `ec-02` answered a Pokémon question; `ec-01` accepted an empty query.

These are trust failures, not capability failures. The model is fluent. The gap is that nothing between retrieval and the rendered answer asks *"do we actually have the evidence, and does the answer hold up against it?"*

---

## Target user & Jobs-to-be-Done

**Primary user:** a job-seeker uploading their own résumé for grounded guidance (the three personas in [`GOLDEN_PATHS.md`](../data/eval-benchmark/GOLDEN_PATHS.md): recent grad, career switcher, mid-career analyst).

**JTBD (user):**
- *When* I ask a high-stakes career question, *I want* the system to be honest about what my résumé does and doesn't support, *so I can* avoid walking into an interview or background check on a claim I can't defend.
- *When* the system isn't sure, *I want* it to tell me and offer human review, *so I don't* over-trust a confident-sounding guess.

**JTBD (operator — the solo builder running this):**
- *When* an answer goes out, *I want* a machine-readable record of how well it was grounded and why it did/didn't escalate, *so I can* calibrate thresholds on real traffic and catch the failure classes the red-team found.

---

## Goals

| # | Goal | How we'll know (metric — see [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md)) |
|---|------|------|
| G1 | Never answer confidently from a sparse corpus region | Share of answers where `region = sparse` that route to human — **pending real traffic** |
| G2 | Catch the false-confirmation class the in-app judge misses | Grounding gate `flagged` rate with the semantic judge active — **pending real traffic** |
| G3 | Make every escalation explainable to the user and loggable for the operator | `signals.hitl.reason` + `triggers[]` present on 100% of answered responses (structural, verifiable in `route.ts:416-429`) |
| G4 | Spend no extra LLM calls on the happy path | A first-pass answer that clears the bar = exactly 1 generation + 1 judge call (`satisficing.ts:148-158`); a redundant re-search is skipped (`info-gain.ts:200-210`) |
| G5 | Degrade honestly when unconfigured rather than fake an answer | Missing key → 503 (`route.ts:86-93`); unreachable grounding peer → `unavailable` (`grounding/index.ts:111-121`) |

## Non-goals

- **Not** a calibration of the thresholds. Every threshold shipped is an **unvalidated default** (`data-density.ts:49-55`, `satisficing.ts:44-48`, `info-gain.ts:57-60`). Calibration is gated on real traffic — see [ROADMAP.md](ROADMAP.md).
- **Not** auth, rate limiting, or per-user identity. `userId` is still aliased to `resumeId` (`route.ts:99-105`); fixing that is out of scope here.
- **Not** a human-review queue UI. The gate *routes* to human review and surfaces a banner; the actual reviewer workflow/inbox is not built.
- **Not** the report path. Trustworthy Answering wires into `/api/query` (chat). The orchestrator (`/api/agents/report`) sets per-section eval scores but does not yet run the density/grounding gates — see Scope cuts.
- **Not** an outcome claim. We do not assert that grounded answers get users more interviews; outcome tracking is explicitly deferred ([EVAL_DESIGN.md](EVAL_DESIGN.md), "What this can't catch").

---

## Shipped requirements

Each requirement is **R**ealized in code today. Citations are `file:line` ranges at the current `feat/wired-product` HEAD.

### R1 — Input + readiness floor (honest failure before any model call)
- Reject empty/whitespace queries with `400` before embedding — closes red-team `ec-01` (`route.ts:73-78`).
- Require `resumeId` (`route.ts:69-71`).
- If OpenAI/Supabase env is not configured, return a `503` "service unavailable" payload instead of failing deep in retrieval and surfacing as a fake empty answer (`route.ts:86-93`, `lib/service-config.ts`).

### R2 — Pre-generation: data-density confidence + HITL routing
- Estimate local corpus density from the cosine similarities the retrieval RPC already returns — **zero extra cost**, no extra embedding/DB call (`data-density.ts:144-185`, fed from `route.ts:147-150`).
- Classify the query region as `dense | borderline | sparse` and derive a `confidence` in `[0,1]` (`data-density.ts:59`, `82-97`).
- A `sparse` region floors confidence and recommends human review (`data-density.ts:168`).
- Combine the density signal with the existing keyword high-stakes gate (`detectHighStakes`, `lib/hitl-detection.ts:42`) into one routing decision with named `triggers` (`routeForHitl`, `data-density.ts:249-269`; wired at `route.ts:194-195`).
- When no documents are retrieved at all, return a labelled low-confidence state — **never** a confident fabricated answer (`route.ts:199-222`).

### R3 — Pre-generation: info-gain-gated re-retrieval
- Build a deterministic, **key-free** reformulation by expanding the query with the user's stored profile terms — target role, companies, skills (`expandQueryWithProfile`, `retrieval-pipeline.ts:234-255`; wired at `route.ts:160-162`).
- Re-retrieval is *considered* only when the first page is non-empty and not already dense (`retrieval-pipeline.ts:144-158`).
- It actually *fires* only when combined semantic-drift + lexical-novelty info-gain clears the threshold, or the page was sparse (a hard "need more evidence" signal) (`info-gain.ts:170-211`, `retrieval-pipeline.ts:169-176`).
- The denser of the two pages wins; a skipped redundant call is recorded as `savedCall` (`retrieval-pipeline.ts:178-214`).

### R4 — Generation: satisficing stop with safety floors
- Generate → judge against the live 4-dimension rubric (`lib/evals/coaching-quality.ts`) → stop as soon as `overall ≥ target` **and** the honesty + grounding floors are met (`satisficing.ts:134-158`; defaults `overallTarget=80`, floors `{honesty:4, grounding:4}`, `satisficing.ts:73-78`).
- A high average cannot mask a safety-relevant weakness: an answer slick on actionability but weak on grounding will not satisfice (`satisficing.ts:30-33`).
- Plateau detection (`diminishing-returns`) and a hard `maxIterations` backstop prevent unbounded loops (`satisficing.ts:160-182`).
- The revise prompt explicitly forbids fabricating to raise the score (`route.ts:38-60`).
- If the judge itself throws, fall back to a single grounded generation with no scores — same resilience as before the gate (`route.ts:311-318`).

### R5 — Post-generation: grounding gate (independent cross-check)
- Extract the answer's factual claims about the user and reconcile them against the retrieved résumé evidence via Pacioli's `POST /api/reconcile` engine (`runGroundingGate`, `lib/grounding/index.ts:69-156`; wired at `route.ts:371-389`).
- This is the explicit counter to the `mr-02` blind spot: a *second, independent* engine that does not share the in-app judge's rubric (`grounding/types.ts:18-23`).
- **Honest status semantics** (`grounding/types.ts:76-93`): `clean` is only reported when the semantic judge actually ran; otherwise `deterministic-only` makes clear that a "0 unsupported" is **not** a clean bill of health (`grounding/index.ts:138-145`).
- The gate is built never to throw and never to invent a verdict; unconfigured → `skipped`, unreachable → `unavailable` (`grounding/index.ts:74-121`, belt-and-suspenders try/catch at `route.ts:379-389`).

### R6 — One escalation decision + one signals payload
- A below-bar satisficing result *or* a `flagged` grounding result is itself a reason to escalate, added to the density/keyword triggers (`route.ts:394-398`).
- The response returns a single `signals` object — `confidence`, `region`, `meanSimilarity`, `hitl{routeToHuman,triggers,reason}`, `reretrieval`, `satisficing`, `grounding` (`route.ts:416-429`), consumed by the UI's `QuerySignals` type (`app/page.tsx:34-73`).

### R7 — UI surfacing (the user sees the trust signal)
- A "consider human review" banner renders when `routeToHuman` is true, with human-readable trigger labels (`app/page.tsx:84-89`, `372-...`).
- The grounding result renders as a flagged-statements callout or a "claims reconciled" note, honestly distinguishing `clean` from `deterministic-only` (`app/page.tsx:429-470`).
- A subtle note shows when a re-retrieval was attempted/fired/skipped (`reretrievalNote`, `app/page.tsx:91-102`).

---

## Success metrics (defined; values pending real traffic)

The full funnel + event taxonomy lives in [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md). Headline definitions:

- **North-star:** *Trustworthy answer rate* — share of answered queries that clear the satisficing bar **and** pass the grounding gate with the semantic judge active, **and** were not silently sparse. **Target: pending real traffic.**
- **Guardrail:** *Over-escalation rate* — share of answers routed to human that a reviewer would deem unnecessary. Defined; **pending real traffic** (needs the reviewer workflow that is out of scope here).
- **Cost guardrail:** mean LLM calls per answered query (target ≈ 2 on the happy path by construction — `satisficing.ts:148-158`). **Pending real traffic** for the true distribution.

> **The only committed number** is the red-team QA sample: of 25 adversarial prompts, the tally was **5 none / 5 minor / 9 material / 6 failed** (`red-team-observations.md:304-312`). This is a **QA sample of one persona on one date**, *not* a resolution rate and *not* a measure of the gates (the gates were built *after* and *in response to* this run). It is the design input, not a result.

---

## Scope cuts (explicit)

- **Report path excluded.** `/api/agents/report` (the 8-node LangGraph orchestrator, `lib/report-graph.ts`) runs per-section evals but **not** the density/grounding gates. Cut to keep the first wiring on one surface; the chat path is where the red-team ran.
- **Threshold calibration cut.** Shipped with unvalidated defaults; calibration needs real traffic (ROADMAP "Gated on the un-fakeable").
- **Grounding semantic judge off by default.** Without `PACIOLI_API_KEY` + a judge mode, the gate runs deterministic-only (`grounding/config.ts:71-96`) — structural over-claims only. Honest, but not the full check.
- **Memory-key fix cut.** The `userId = resumeId` aliasing (cross-session leakage, red-team finding #3) is mitigated for eval runs via `skipMemory` (`route.ts:99-131`) but not fixed for real users.
- **Reviewer inbox cut.** We route to human; we do not build the human's queue.

---

## Rollout & flagging plan

The capability is **config-gated, not feature-flag-gated** — the gates are always in the request path, but each is independently inert until its dependency is present. This is the rollout lever today:

| Gate | Enabled by | Default state | Safe-off behavior |
|------|-----------|---------------|-------------------|
| R1 readiness floor | `OPENAI_API_KEY` + Supabase env | active when keys present | `503` honest "not configured" (`service-config.ts`) |
| R2 density/HITL | always on (uses RPC similarities) | active | escalates more, never less |
| R3 re-retrieval | `skipMemory=false` + a stored profile | active for real users | benchmark runs pass `skipMemory:true` to measure base retrieval (`route.ts:160-162`) |
| R4 satisficing | always on | active; capped to 1 iteration for benchmark runs (`route.ts:300-302`) | judge failure → single generation fallback |
| R5 grounding | `PACIOLI_RECONCILE_URL` (+ `PACIOLI_API_KEY`/judge for semantic) | off until URL set | `skipped` (not configured) — never blocks |

**Staged plan:**
1. **Ship dark (today):** gates live, grounding URL unset → `skipped`. Density/satisficing already shaping answers.
2. **Turn on grounding deterministic-only:** set `PACIOLI_RECONCILE_URL`. Watch `unavailable` rate; confirm no latency regression (8s timeout, `grounding/config.ts:44`).
3. **Turn on semantic judge:** add `PACIOLI_API_KEY` + judge mode; now `clean` is meaningful.
4. **Calibrate:** with real `signals` traffic, replace unvalidated defaults via dated [DECISION_LOG.md](DECISION_LOG.md) entries.
5. **Extend to report path** once chat-path thresholds are trusted.

**Rollback:** unset the relevant env var. Each gate's safe-off state is a labelled non-blocking result, so rollback degrades trust signals without breaking the answer path.

---

## Risks

| Risk | Likelihood | Impact | Mitigation (in code unless noted) |
|------|-----------|--------|-----------------------------------|
| Unvalidated thresholds over- or under-escalate | High (they are illustrative) | Medium | Labelled everywhere as unvalidated; calibration gated on real traffic; direction-of-effect, not absolute, drives behavior |
| Grounding "clean" over-trusted when judge is off | Medium | High | `deterministic-only` status forbids reading a pass as clean (`grounding/types.ts:76-93`) |
| Pacioli latency adds to answer time | Medium | Medium | 8s timeout + never-throws + `unavailable` fallback (`grounding/config.ts:44`, `grounding/index.ts:111-121`) |
| Over-escalation annoys users / erodes trust in the banner | Medium | Medium | Guardrail metric defined; needs reviewer signal — **pending real traffic** |
| Cross-session memory leak (red-team #3) still affects real users | Known | Medium | Out of scope here; tracked in ROADMAP; mitigated for evals via `skipMemory` |
| In-app judge bias (favors structure/length) leaks into satisficing | Medium | Medium | Grounding gate is the independent cross-check; honesty/grounding floors are hard, not averaged |

---

## Open questions / dependencies

- What `sparseSimilarity`/`denseSimilarity` operating point matches the real embedding distribution? (Needs traffic.)
- Is the Pacioli deployment the operator wants to depend on, and at what judge mode? (Cost/latency trade — see [`grounding/config.ts`](../lib/grounding/config.ts).)
- Does the reviewer workflow live in this app or externally? (Blocks the over-escalation guardrail metric.)

---

## Appendix — links

- Live route: [`app/api/query/route.ts`](../app/api/query/route.ts)
- Gates: [`lib/quality-gates/`](../lib/quality-gates/) · Grounding: [`lib/grounding/`](../lib/grounding/)
- Orchestrator: [`lib/report-graph.ts`](../lib/report-graph.ts)
- Rubric: [`lib/evals/coaching-quality.ts`](../lib/evals/coaching-quality.ts) · [EVAL_DESIGN.md](EVAL_DESIGN.md)
- Decisions: [DECISION_LOG.md](DECISION_LOG.md) (esp. Decision 11 HITL ladder)
- Evidence: [Red-team](../data/eval-benchmark/red-team-observations.md) · [Coverage](../data/eval-benchmark/COVERAGE.md) · [Preregistration memo](../data/eval-benchmark/PM_DECISION_MEMO.md)
- Companion docs: [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md) · [ROADMAP.md](ROADMAP.md)
