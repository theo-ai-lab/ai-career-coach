# OOD Gate Calibration

Provenance and method for the **pre-generation out-of-distribution (OOD) /
retrieval-surprise gate** (`lib/quality-gates/ood-gate.ts`). The gate scores how
*surprising* a query is to the résumé corpus and, above a **calibrated**
threshold, short-circuits to an honest "that isn't in your background — want to
add it?" *before* generation, instead of letting the model confabulate on a
question it has no evidence for.

This document exists so the shipped threshold is **not a magic constant**. Every
number below is regenerated from committed data by a single script and re-derived
independently in a test, so the docs, the code, and the artifact can never
silently disagree.

> TL;DR — The score's functional form and the abstain budget α are fixed *a
> priori* (before looking at any detection outcome). The **only** value fit to
> data is the abstention threshold τ, and it is fit by the standard
> split-conformal quantile, not hand-tuned. A held-out split is scored **once**
> to show the budget holds out-of-sample. At n=24 the realized rates carry wide
> Wilson intervals — reported honestly below, never as a guarantee.

---

## 1. What is fixed a priori (not fit to data)

These are chosen before any detection outcome is observed, so they cannot be
tuned to flatter a metric:

| Choice | Value | Rationale |
|---|---|---|
| Score inputs | top-k cosine similarities the pgvector RPC already returns | **Keyless** — no extra embedding/LLM/reranker call |
| `coverage` | `clamp(max similarity, 0, 1)` | Best single chunk match |
| `centroidProximity` | `clamp(mean similarity, 0, 1)` | Mean cosine to the retrieved neighbourhood — the most recoverable surrogate for proximity-to-centroid when the RPC returns *similarity*, not chunk vectors |
| `support` | `0.6·coverage + 0.4·centroidProximity` | Best-match dominates; neighbourhood mean is a tie-breaker |
| OOD `score` | `1 − support`, in [0,1] | Higher ⇒ more surprising |
| `margin` | `s₁ − mean(s₂…s_k)` | **Diagnostic only** — surfaced but deliberately **not** weighted into the decision (see §5) |
| Target abstain budget **α** | **0.15** | Conservative: prefer to keep answering and rely on the post-generation grounding gate over an aggressive pre-generation cut |
| Quality bar (for lossless check) | overall ≥ 80, grounding ≥ 4, honesty ≥ 4 | Mirrors the **existing** `DEFAULT_SATISFICING_CRITERIA`, not a new bar |
| Split seed | 42 | Matches the eval benchmark's documented seed convention |

The weights `{coverage: 0.6, centroidProximity: 0.4}` are echoed into the
calibration artifact and asserted equal to `OOD_SCORE_WEIGHTS` by
`ood-gate.test.ts`, so they cannot drift apart.

## 2. The threshold τ (the one value fit to data)

τ is calibrated by **split-conformal prediction** ([Vovk et al. 2005;
Angelopoulos & Bates 2021, arXiv:2107.07511], applied to abstention as in
*Mitigating LLM Hallucinations via Conformal Abstention*, Yadkori et al.,
arXiv:2405.01563).

Given `n` calibration OOD scores and target budget α, the abstention threshold is
the order statistic at the **finite-sample-corrected** rank

```
rank = ⌈(n + 1)(1 − α)⌉
```

i.e. τ = the `rank`-th smallest calibration score. A new query abstains **iff**
its score is *strictly greater* than τ. Under exchangeability of the new query
with the calibration sample, this rule targets an abstain rate of ≈ α on unseen
queries. When `rank > n` the sample is **too small to certify α**; the script
emits `threshold: null` and the runtime gate then **never abstains** rather than
inventing a cutoff (`decideOOD` returns `abstain: false` with an explicit
"no calibrated threshold" reason).

### Shipped values (committed `ood-calibration.json`)

Calibrated from `data/eval-benchmark/red-team-raw-results.json` (the empty-query
case `ec-01` is excluded — production input-validation rejects empty queries
before the gate, so it can never reach it):

| Quantity | Value |
|---|---|
| α (target abstain budget) | 0.15 |
| n (queries with retrieved similarities) | 24 |
| conformal rank `⌈25·0.85⌉` | 22 |
| **τ** (22nd smallest OOD score) | **0.826013** |
| realized in-sample abstain rate (#scores > τ ÷ n) | 0.083333 (2/24) |

The realized in-sample rate (8.3%) sits *below* the 15% budget because the OOD
score distribution is discrete and right-skewed: only the two clearly-off-résumé
red-team queries (`cg-03` medical, `ec-02` gaming) score above τ. That is the
expected, conservative behaviour — α is an upper target, not a quota.

## 3. Held-out honesty check (scored once)

A tuned number reported as a true out-of-sample rate is slop. To guard against
that, a single fixed-seed **50/50 split** is scored exactly **once**: τ is refit
on the calibration half and evaluated on the untouched validation half. It is
**not** searched over seeds or splits.

| Quantity | Value |
|---|---|
| seed | 42 |
| calibration / validation sizes | 12 / 12 |
| τ refit on calibration half | 0.893158 |
| validation abstain count | 0 |
| validation abstain rate | 0.0 |
| Wilson 95% interval on the validation rate | **[0, 0.2425]** |

The shipped τ is then **refit on all n = 24** (standard split-conformal practice
once the held-out check has done its job). The honest reading: with only 12
validation points the abstain rate is consistent with the 15% budget but the
Wilson interval is wide (up to ~24%); this validates the *method*, not a tight
operating point.

## 4. Cascade-telemetry slice (zero model spend)

The same replay produces the repo's slice of the suite-wide cascade contract
(`lib/quality-gates/cascade-replay.json`, consumed by `cascade-telemetry.ts`) for
the **OOD-gate → LLM-generation** boundary. It is computed entirely from
already-recorded data — the cheap-tier signal (retrieval similarities) **and** the
expensive-tier outcome (the committed LLM answer + LLM-judge scores) — so it costs
**no extra model calls**:

| Field | Value | Meaning |
|---|---|---|
| `alpha` | 0.083333 | Fraction the cheap deterministic tier resolved without escalating to the LLM |
| `expensiveShare` | 0.916667 | Fraction that fell through to LLM generation + judge |
| `disagreementRate` | 0 | Of the resolved queries, fraction the expensive tier would have answered *above the quality bar* |
| `losslessViolations` | 0 | Count of cheap fast-path resolutions the expensive tier would NOT have made (i.e. a genuinely good answer we denied) |
| `n` | 24 | Replay sample size |

Both queries the gate resolves (`cg-03`, `ec-02`) were scored by the LLM judge
**below** the quality bar (grounding 2/5 and 1/5; overall 65 and 55) — exactly the
confabulation-risk cases the gate is meant to catch. So the deterministic
fast-path denied **zero** answers the expensive tier would have rated as good:
**losslessViolations = 0** on this corpus. That is a *measured* statement about
24 committed queries, not a guarantee about future traffic.

This is a deterministic-vs-deterministic measurement of a deterministic gate
against *already-paid-for* judge labels, so the offline replay adds **zero model
spend**.

## 5. Why `margin` is not in the decision

`margin = s₁ − mean(s₂…s_k)` is computed and surfaced as a diagnostic, but it is
**not** weighted into the calibrated score. At this corpus's geometry it does not
separate in- from out-of-distribution queries, so weighting it would be an
unjustified tuned knob. Keeping it out of the decision keeps the score's
functional form genuinely *a priori*.

## 6. Honest caveats (small-n)

- **n = 24.** Every rate here carries a wide Wilson interval (reported, never
  hidden). We do **not** extrapolate an asymptote over gold-set size, and we do
  **not** print a distribution-free coverage *guarantee* as a headline — at this
  n the conformal bound is the *method's* justification (the "why"), while the
  realized numbers are reported with their intervals.
- **Exchangeability.** The conformal target assumes the deployed query
  distribution is exchangeable with this red-team set. Real traffic will differ;
  τ should be **recalibrated** against production traces before being trusted as
  a release gate. The gate is additive and fail-open by construction: below τ
  nothing changes, and an uncertifiable α yields *never abstain*.
- **Discrete scores.** With few off-résumé queries the realized abstain rate is
  quantized; the in-sample 8.3% is one such quantum below the 15% target.

## 7. Regenerate / verify

```bash
# Regenerate both artifacts from the committed red-team run (zero model spend):
npx tsx scripts/calibrate-ood-gate.ts

# Verify the on-disk artifacts match what the data + procedure derive:
npx tsx scripts/calibrate-ood-gate.ts --check
```

`scripts/calibrate-ood-gate.ts` writes both `ood-calibration.json` and
`cascade-replay.json`. The `--check` mode fails (exit 1) on any drift.
Independently, `ood-gate.calibration.test.ts` re-derives τ and the cascade slice
from the committed red-team data using the shared primitives and asserts they
equal the committed artifacts — so the shipped threshold can never silently
diverge from this document.

## References

- Yadkori, Y. A., et al. *Mitigating LLM Hallucinations via Conformal
  Abstention.* arXiv:2405.01563 (2024). — abstention as a conformal risk-control
  rule (the "why").
- Angelopoulos, A. N., & Bates, S. *A Gentle Introduction to Conformal Prediction
  and Distribution-Free Uncertainty Quantification.* arXiv:2107.07511 (2021). —
  the `⌈(n+1)(1−α)⌉` finite-sample quantile.
- Vovk, V., Gammerman, A., & Shafer, G. *Algorithmic Learning in a Random World.*
  Springer (2005). — split-conformal foundations.
- Wilson, E. B. *Probable Inference, the Law of Succession, and Statistical
  Inference.* JASA (1927). — the small-n binomial interval used for the realized
  rates.
