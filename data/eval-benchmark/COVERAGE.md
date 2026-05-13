# Eval Case Coverage

Canonical inventory of eval case coverage across the 4-dimension × 3-case-type grid for the AI Career Coach benchmark. This file is the single source of truth for case-count claims. Other documents in this repo (`EVAL_DESIGN.md`, `PM_DECISION_MEMO.md`, the benchmark `README.md`) should reference this file rather than restate numbers independently.

## Current state (v3)

| Dimension | Normal | Adversarial | Edge | Total |
|---|---|---|---|---|
| Actionability | 1 | 0 | 0 | 1 |
| Personalization | 1 | 0 | 0 | 1 |
| Honesty | 0 | 0 | 0 | 0 |
| Grounding | 0 | 0 | 0 | 0 |
| **Total** | **2** | **0** | **0** | **2** |

Files on disk:
- `cases/normal/01-actionability-grad.json` — actionability dimension
- `cases/normal/02-personalization-pm-pivot.json` — personalization dimension

The `adversarial/` directory exists but is empty. The `edge/` directory has not been created yet.

## v4 target state

Target distribution: 2 normal + 1 adversarial per dimension = N=12. Edge cases deferred to v5+.

| Dimension | Normal | Adversarial | Edge | Total |
|---|---|---|---|---|
| Actionability | 2 | 1 | 0 | 3 |
| Personalization | 2 | 1 | 0 | 3 |
| Honesty | 2 | 1 | 0 | 3 |
| Grounding | 2 | 1 | 0 | 3 |
| **Total** | **8** | **4** | **0** | **12** |

Adversarial weighting: each dimension gets one stress-test case alongside two routine cases. This trades statistical power on easy inputs for direction-of-effect signal on the hard cases that drive real product decisions.

## Design principles

- **Incremental case-writing.** Batches of ~10-25 cases at a time. Run the eval on each batch, learn from the results, refine rubrics or case design before adding more. Avoids backfilling 200 cases against an unvalidated rubric.
- **Balanced expansion per batch.** Each batch should cover all four dimensions, not one dimension at a time. This catches cross-dimension interactions (e.g., a case where high actionability collapses grounding) early.
- **Adversarial-weighted.** Direction-of-effect signal on adversarial cases is more decision-relevant than confirmatory power on routine cases. Treat normal cases as the regression-safety net; treat adversarial cases as the decision driver.
- **Preregistered.** Cases are designed before runs, not backfit to results. Adding a case after seeing a bad model output is post-hoc rubric gaming and is not how cases enter this inventory.

## Roadmap

| Batch | Version | Case count | Status | Goal |
|---|---|---|---|---|
| Batch 1 | v3 | N=2 | Complete | Scaffold the case schema, prove the eval pipeline end-to-end on a tiny grid |
| Batch 2 | v4 | N=12 | Target | Cover all four dimensions × both normal and adversarial. Decision-grade signal on each rubric dimension |
| Batch 3 | v5 | N=50 | Target | Expand persona diversity. Add edge cases (resume gaps, non-traditional paths, career re-entry) |
| Long-term | — | ~N=275 | Aspirational | Full grid coverage including underrepresented persona axes (geographic, domain depth, edge cases) |

## How to read this doc

- **Case-count claims live here.** Other documents in this repo should reference this file rather than restate numbers. If a downstream doc claims "N=12 preregistered cases," it should be linking back to this file's v4 target rather than making a standalone claim.
- **The numbers reflect on-disk reality.** When a case file is added or removed under `cases/`, the current-state grid in this doc updates in the same change. The two should never diverge.
- **Aspirational counts are clearly labeled.** N=50 and N=275 are roadmap targets, not current state. They are useful for setting up the trajectory but should not be cited as if they exist on disk today.
