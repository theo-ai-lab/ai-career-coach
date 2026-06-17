# Preregistration Memo — Planned Production Model Migration (decision pending data)

**Date:** 2026-05-11
**Status:** Preregistration — thresholds fixed in advance; result values pending the v4 cross-vendor adversarial run. This is a decision *protocol*, not a decision report.
**Evidence:** Current case inventory and expansion roadmap in [COVERAGE.md](COVERAGE.md). Preregistration manifest and run results not yet authored; benchmark is at N=6 today (v3 scaffold: 5 normal + 1 adversarial) with v4 target N=12 — see COVERAGE.md.

> **Models referenced in this repo — three distinct roles (don't conflate them):**
> - **Live app generation** — `gpt-4o-mini` (temperature 0.2): during the early-2026 pilot the deployed product ran this model to write responses; the pilot is no longer accessible.
> - **Current in-app eval judge** — `gpt-4o-mini` (temperature 0): the LLM-as-judge that scored the pilot's responses (and the judge behind the May 2026 red-team run).
> - **Planned benchmark judge / council** — a premium cross-vendor judge reserved for the offline benchmark (a single cross-vendor model near-term, e.g. a Claude judge such as `claude-sonnet-4-6`; a 3-model council at the high end). All premium model IDs in this memo are illustrative/planned targets, not models that have been run against this benchmark yet.

---

## Problem

**Users:** a real but small user base using AI Career Coach for resume-grounded career guidance (RAG-backed Q&A). Approximate usage figures (~57 users / 900+ queries as of May 2026) come from PostHog/Supabase analytics that are not committed to this repo, so they are cited here as context, not as in-repo-verifiable evidence.

**Failure mode this memo decides on:** the pilot's stack ran on gpt-4o-mini (May 2024) and gpt-4o (Jul 2024) — multi-cycle-stale models. The question this memo answers: **does migrating to a newer-generation model pair (illustrative target: gpt-5.4-mini + gpt-5.5; exact IDs not finalized) make user-facing Honesty better, worse, or neither?**

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

The benchmark (v3 scaffold at N=6 today, v4 target N=12 — see [COVERAGE.md](COVERAGE.md) for case inventory) uses preregistered methodology: response-blinding, k=3 judge passes, a planned cross-vendor judge (`claude-sonnet-4-6`, per the model-roles note above) with randomized ordering. It measures adversarial Honesty as a direction-of-effect signal — not a hypothesis test. Bootstrap CI on case-level deltas (10K resamples, seed=42, percentile method) reports uncertainty bounds for transparency, framed as descriptive/exploratory in line with industry practice for small eval sets that quantify product-level progress without overclaiming. I'm using this evidence to decide a rollout gate, not to publish a research finding. Small-N preregistered evals are appropriate for product decisions and demonstrate calibrated communication of uncertainty — which aligns with calibrated-uncertainty norms in the LLM evaluation literature.

## Trade-offs (named explicitly)

- **Accept higher eval cost (~$7) for cross-vendor judging** vs free self-grading. A cross-vendor judge avoids the self-grading bias of using one model family to both generate and grade, and avoids the self-grading shortcut the smoke benchmark takes.
- **Accept small-sample statistical weakness** (N=6 today, N=12 at v4 target) in exchange for methodology rigor + preregistration. Small N limits statistical power; the explicit descriptive/exploratory framing is how that limitation is handled in the open, not the headline claim.
- **Accept conservative "gate to admin-only" as default fallback** rather than aggressive "ship to all." This ships fewer users into potential Honesty regression in exchange for keeping the migration available as a feature flag instead of a code revert.
- **Accept that migration impact is partially confounded** (prompt incompatibility, reasoning defaults, output format drift). v3 reports two deltas separately — cross-vendor judge held constant, and self-judge held constant via gpt-4o-mini on both runs — to isolate generator change from judge change. Remaining confounds disclosed in DECISION_LOG.

## Next 2 weeks

1. Run v3 Steps 1–9 (disk cleanup → case authoring → eval/v2/ module → manifest commit → migration PR → API compat + smoke validate → Run #1 → Run #2 → Step 8.5 second-judge agreement → analysis).
2. Apply decision threshold above to Run #2 cross-vendor adversarial Honesty result. Write the actual decision into this memo (replacing the template values in Decision table with observed values).
3. Author the three DECISION_LOG entries (cross-vendor methodology + model migration + OpenRouter deferral) per v3 Step 10.
4. Update README headline + EVAL_DESIGN.md cross-vendor section + archive v1 README to HISTORY.md (v3 Steps 11–13).
5. Dogfood the migrated stack for the "What surprised me" section below (v3 Step 16 implied — observed failure mode from real product usage, not from the preregistered case list).
6. If decision was "ship to all": deploy, monitor for 1 week via PostHog, write follow-up DECISION_LOG entry. If "gate to admin-only" or "roll back": author 3 additional adversarial cases targeting the gating failure mode.

## What surprised me — pending real dogfooding (intentionally unfilled)

*Will add via separate commit once real product usage produces an unanticipated observation. Do not fabricate placeholder content.*

*(An empty TODO marker is better than fabricated content; the section's value is signaling that the author waited for real observation rather than backfilling.)*
