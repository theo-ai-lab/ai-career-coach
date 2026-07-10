# Roadmap — AI Career Coach

**Last updated:** 2026-06-18 · **Horizon:** Now (this iteration) / Next (1-2 iterations) / Later (directional)

> Prioritization is by **user outcome**, not feature count. Every item names the
> outcome it serves, ties to code that exists today, and carries an honest
> effort × impact estimate. The bottom section — **Gated on the un-fakeable** —
> is the part that no amount of building can shortcut: it needs real users, an
> owned analytics stream, live API keys, and thresholds calibrated on real data.
> Those gate the *claims*, not the code.

Companion docs: [PRD.md](PRD.md) (the shipped capability) · [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md) (how we'll measure) · [DECISION_LOG.md](DECISION_LOG.md) (decisions, incl. the "Decisions Pending" table) · [Red-team findings](../data/eval-benchmark/red-team-observations.md).

Scoring legend: effort `S` (<1 day) / `M` (days) / `L` (week+); impact = expected lift on the [trust funnel](METRICS_FRAMEWORK.md#2-the-trust-funnel).

---

## Now — wired, hardening, and instrumenting

The Trustworthy Answering stack ([PRD.md](PRD.md)) is in the live path. "Now" is about making it *observable* and *honest* before chasing new capability.

| # | Item | User outcome | Effort | Impact | Grounding |
|---|------|--------------|--------|--------|-----------|
| N1 | **Emit the PostHog event taxonomy** | The signals users already get become measurable, so every later threshold change is evidence-based instead of guessed | S–M | High (unblocks all metrics) | Provider wired (`app/providers.tsx`); events not yet emitted ([METRICS_FRAMEWORK.md §4](METRICS_FRAMEWORK.md#4-posthog-event-taxonomy)) |
| N2 | **Turn on grounding deterministic-only in a real env** | Users start getting the independent claim cross-check that catches the `mr-02` false-confirmation class | S | High | `runGroundingGate` wired (`route.ts:371-389`); just needs `PACIOLI_RECONCILE_URL` (`grounding/config.ts:11-24`) |
| N3 | **Surface the trust banner copy review** | Users understand *why* an answer was escalated, not just that it was | S | Medium | Trigger labels exist (`app/page.tsx:84-89`); copy is functional, not yet polished |
| N4 | **Extend `answer_returned` to capture `503`/no-doc honestly** | Operator sees the honest-floor rate (declines vs fabrications) | S | Medium | States exist (`route.ts:86-93`, `199-222`); not yet evented ([METRICS_FRAMEWORK.md §3](METRICS_FRAMEWORK.md#3-activation--retention)) |

**Exit criteria for "Now":** the [trust funnel dashboard](METRICS_FRAMEWORK.md#5-dashboards-build-order) renders on real-or-staged traffic, and grounding returns `clean`/`deterministic-only`/`flagged` (not just `skipped`) in at least one deployed environment.

---

## Next — close the highest-signal red-team gaps

Ordered by red-team signal density ([`red-team-observations.md` summary](../data/eval-benchmark/red-team-observations.md)).

| # | Item | User outcome | Effort | Impact | Grounding |
|---|------|--------------|--------|--------|-----------|
| X1 | **Turn on the semantic grounding judge** | A "clean" grounding result actually means semantic mismatches were checked — the difference between trust and theater | M | High | Gated on `PACIOLI_API_KEY` + judge mode (`grounding/config.ts:71-96`); status semantics already honest (`grounding/types.ts:76-93`) — see *Gated on the un-fakeable* |
| X2 | **Real per-user identity (auth)** | A returning user resumes their *own* history behind a verified identity | M–L | High | The unsafe default is closed: memory is conversation-scoped unless an explicit `userId` is claimed (`lib/coach-pipeline.ts`; red-team #3 regression lock in `lib/coach-pipeline.test.ts`). What remains is *authenticating* that claim |
| X3 | **Domain/scope gate on the chat path** | The coach declines off-topic asks instead of confidently answering (red-team `ec-02` Pokémon, `mr-03` off-target PM pivot) | M | High | No scope check today; density gate handles *thin* support, not *off-domain* — distinct gap |
| X4 | **Professional-referral gate for legal/tax/immigration** | High-stakes credential-gap questions get a "see a licensed professional" floor, like the medical line already holds (red-team `cg-01/02/04`) | M | High | Keyword gate exists for high-stakes career terms (`hitl-detection.ts:6-35`); legal/tax/immigration not covered |
| X5 | **Extend the gates to the report path** | The full-report orchestrator gets the same density/grounding trust floor as chat | M | Medium | Orchestrator runs per-section evals only (`report-graph.ts`); density/grounding not wired ([PRD.md](PRD.md) scope cuts) |
| X6 | **Author the N=12 preregistered eval grid** | Threshold and model decisions rest on a real adversarial grid, not N=6 scaffold | M | Medium | v4 target in [`COVERAGE.md`](../data/eval-benchmark/COVERAGE.md); decision protocol in [`PM_DECISION_MEMO.md`](../data/eval-benchmark/PM_DECISION_MEMO.md) |

---

## Later — directional, not yet specified

| # | Item | User outcome | Effort | Impact |
|---|------|--------------|--------|--------|
| L1 | Reviewer workflow / human-review inbox | The `routeToHuman` escalation lands somewhere a human acts on it (today it only renders a banner) | L | High |
| L2 | Procedural memory (learned coaching style) | The coach adapts to how a user likes feedback over time | L | Medium |
| L3 | Outcome tracking (did acting on advice → interviews/offers?) | The only true measure of value; today explicitly *not* measured ([EVAL_DESIGN.md](EVAL_DESIGN.md)) | L | High (but longitudinal) |
| L4 | Embedding-model comparison on the owned benchmark | A defensible retrieval-quality migration claim instead of a blog-post switch | M | Medium |
| L5 | RAGAS / retrieval-recall metric | Isolate retrieval quality from generation quality | M | Medium |

---

## Gated on the un-fakeable

These are the dependencies that **cannot be satisfied by writing more code or docs**. They are called out explicitly so the roadmap stays honest: until each is real, the corresponding claim stays marked *pending real traffic* / *target, not yet measured* throughout [PRD.md](PRD.md) and [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md).

| Un-fakeable dependency | Blocks | Why it can't be shortcut | Status today |
|------------------------|--------|--------------------------|--------------|
| **Real users / live traffic** | Every baseline + target; activation/retention; over-escalation guardrail; North-star (TAR) | A funnel needs people moving through it. Synthetic personas validate the *rubric* ([eval benchmark](../data/eval-benchmark/README.md)), not user behavior. | No live backend; early-2026 pilot analytics inaccessible ([README](../README.md)) |
| **Owned, flowing analytics** | All dashboards; the entire event taxonomy | The PostHog *provider* is wired, but no custom events are emitted yet, and the metric values need a live, owned project to accumulate. | Provider gated on `NEXT_PUBLIC_POSTHOG_KEY` (`app/providers.tsx`); events = task N1 |
| **API keys for the full stack** | Grounding semantic judge (X1); any live answer at all | `clean` grounding requires `PACIOLI_API_KEY` + judge mode (`grounding/config.ts:71-96`); answers require `OPENAI_API_KEY` + Supabase (`route.ts:86-93`). Without them the gates honestly degrade to `skipped`/`503`. | Config-gated; safe-off by design |
| **Threshold calibration on the real embedding distribution** | Trusting density/HITL routing, info-gain, and satisficing as *release gates* rather than direction-of-effect signals | The shipped thresholds are **unvalidated defaults** (`data-density.ts:49-55`, `info-gain.ts:57-60`, `satisficing.ts:44-48`). A mock proves the plumbing, not a tuned operating point. Calibration needs real `signals` traffic + the eval grid (X6). | Defaults documented as illustrative everywhere |

**Discipline:** when an un-fakeable dependency is satisfied, the calibration/result is recorded as a dated entry in [DECISION_LOG.md](DECISION_LOG.md) (the same protocol [`PM_DECISION_MEMO.md`](../data/eval-benchmark/PM_DECISION_MEMO.md) preregisters), and the corresponding *pending* markers in [PRD.md](PRD.md) / [METRICS_FRAMEWORK.md](METRICS_FRAMEWORK.md) are replaced with the observed value and its provenance — never backfilled with a plausible guess.
