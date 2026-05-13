# PM Decision Memo: Production Model Migration to GPT-5.4-mini + GPT-5.5

**Date:** 2026-05-11
**Status:** Decision template — thresholds preregistered; result values pending the v4 cross-vendor adversarial run
**Evidence:** Current case inventory and expansion roadmap in [COVERAGE.md](COVERAGE.md). Preregistration manifest and run results not yet authored; benchmark is at N=2 today (v3 scaffold) with v4 target N=12 — see COVERAGE.md.

---

## Problem

**Users:** ~57 job seekers using AI Career Coach for resume-grounded career guidance (RAG-backed Q&A; 900+ queries to date).

**Failure mode this memo decides on:** the production stack runs on gpt-4o-mini (May 2024) and gpt-4o (Jul 2024) — ~22-month-stale models. The question this memo answers: **does migrating to gpt-5.4-mini + gpt-5.5 make user-facing Honesty better, worse, or neither?**

**Why it matters:** Career advice has real consequences. A model that fabricates credentials the user doesn't have, or hedges with false confidence on weakly-grounded claims, sends users into job searches with bad data. Industry safety policy frameworks classify employment-adjacent advice (resume screening, employment determinations) as high-risk, requiring human-in-the-loop review and disclosure; planned v4 adversarial cases (credentials-gap and uncomfortable-truth scenarios — see [COVERAGE.md](COVERAGE.md)) will measure model behavior against this bright line.

## Decision

**Three-way decision, threshold-gated by the first v4 cross-vendor adversarial Honesty run (once the case grid reaches the v4 target — see [COVERAGE.md](COVERAGE.md)). Thresholds preregistered here, before the run (no post-hoc tuning):**

| If the v4 cross-vendor adversarial Honesty run… | Decision |
|---|---|
| Mean delta ≥ 0 AND no individual case regresses by > 0.5 vs Run #1 | **Ship migration to all users.** |
| Mean delta < 0 OR ≥ 2 adversarial cases regress > 0.5 | **Gate to admin-only.** Author 3 more adversarial cases targeting the failure mode that triggered the gate before broader rollout. |
| Mean drops > 0.5 on majority of adversarial cases | **Roll back the migration PR.** Investigate prompt incompatibility (per Migration Confounding section in v3) before retrying. |

Direction of effect is the decision driver. CI bounds are reported for transparency but are not the gating threshold — even at the v4 target of N=12, the sample is too small for confirmatory inference (see v3 Premise 5).

## Eval evidence

The benchmark (v3 scaffold at N=2 today, v4 target N=12 — see [COVERAGE.md](COVERAGE.md) for case inventory) uses preregistered methodology: response-blinding, k=3 judge passes, `claude-sonnet-4-6` cross-vendor judge with randomized ordering. It measures adversarial Honesty as a direction-of-effect signal — not a hypothesis test. Bootstrap CI on case-level deltas (10K resamples, seed=42, percentile method) reports uncertainty bounds for transparency, framed as descriptive/exploratory in line with industry practice for small eval sets that quantify product-level progress without overclaiming. I'm using this evidence to decide a rollout gate, not to publish a research finding. Small-N preregistered evals are appropriate for product decisions and demonstrate calibrated communication of uncertainty — which aligns with calibrated-uncertainty norms in the LLM evaluation literature.

## Trade-offs (named explicitly)

- **Accept higher eval cost (~$7) for cross-vendor judging** vs free self-grading. Trade buys credibility against the "Claude grading Claude" interviewer objection and against the smoke benchmark's self-grading anti-pattern.
- **Accept small-sample statistical weakness** (N=2 today, N=12 at v4 target) in exchange for methodology rigor + preregistration. Numerate reviewers will dock this; the explicit descriptive/exploratory framing is the mitigation.
- **Accept conservative "gate to admin-only" as default fallback** rather than aggressive "ship to all." This ships fewer users into potential Honesty regression in exchange for keeping the migration available as a feature flag instead of a code revert.
- **Accept that migration impact is partially confounded** (prompt incompatibility, reasoning defaults, output format drift). v3 reports two deltas separately — cross-vendor judge held constant, and self-judge held constant via gpt-4o-mini on both runs — to isolate generator change from judge change. Remaining confounds disclosed in DECISION_LOG.

## Next 2 weeks

1. Run v3 Steps 1–9 (disk cleanup → case authoring → eval/v2/ module → manifest commit → migration PR → API compat + smoke validate → Run #1 → Run #2 → Step 8.5 second-judge agreement → analysis).
2. Apply decision threshold above to Run #2 cross-vendor adversarial Honesty result. Write the actual decision into this memo (replacing the template values in Decision table with observed values).
3. Author the three DECISION_LOG entries (cross-vendor methodology + model migration + OpenRouter deferral) per v3 Step 10.
4. Update README headline + EVAL_DESIGN.md cross-vendor section + archive v1 README to HISTORY.md (v3 Steps 11–13).
5. Dogfood the migrated stack for the "What surprised me" section below (v3 Step 16 implied — observed failure mode from real product usage, not from the preregistered case list).
6. If decision was "ship to all": deploy, monitor for 1 week via PostHog, write follow-up DECISION_LOG entry. If "gate to admin-only" or "roll back": author 3 additional adversarial cases targeting the gating failure mode.

## What surprised me — TODO: fill after dogfooding work

*Will add via separate commit once real product usage produces an unanticipated observation. Do not fabricate placeholder content.*

*(An empty TODO marker is better than fabricated content; the section's value is signaling that the author waited for real observation rather than backfilling.)*
