# Eval Benchmark — AI Career Coach

A controlled synthetic benchmark designed to test whether the LLM-as-judge rubric in `lib/evals/coaching-quality.ts` actually distinguishes good coaching responses from bad ones, and to compare retrieval and generation choices on a fixed test set.

This is the methodology document. Cases live in `cases/`. Personas live in `personas/`. Results from each run live in `results/YYYY-MM-DD.json`. Run with `node scripts/run-eval-benchmark.cjs --smoke` (the runner is CJS + native fetch because tsx + `@langchain/openai` hangs on module load in this Node 24 environment — see the script preamble).

> **Models referenced in this repo — three distinct roles (don't conflate them):**
> - **Live app generation** — `gpt-4o-mini` (temperature 0.2): during the early-2026 pilot the deployed product ran this model to write responses; the pilot is no longer accessible.
> - **Current in-app eval judge** — `gpt-4o-mini` (temperature 0): the LLM-as-judge that scored the pilot's responses (and the judge behind the May 2026 red-team run). See [`docs/EVAL_DESIGN.md`](../../docs/EVAL_DESIGN.md).
> - **Planned benchmark judges / council** — the premium cross-vendor judges and council described below are the *target design* for the offline benchmark. The specific premium model IDs in this document (e.g. `claude-opus-4.7`, `gpt-5.4`, `gemini-3.1-pro`) are illustrative/planned targets, not models that have been run against this benchmark yet.

---

## Purpose

The eval rubric scores responses on 4 dimensions (actionability, personalization, honesty, grounding) — see [`docs/EVAL_DESIGN.md`](../../docs/EVAL_DESIGN.md) for why those four. The rubric is only useful if it scores good responses high and bad responses low *for the right reasons*. Real-user data can't tell you that. You need cases where you already know the correct answer.

This benchmark is not a marketing artifact. Numbers from real users are noisy, unverifiable, and tuned to whoever happened to use the product. A controlled synthetic benchmark with stated hypotheses and adversarial cases is more rigorous, more reproducible, and more defensible than a dashboard number.

The test of whether the eval framework actually works is the committed run data — see the live red-team run in [`red-team-raw-results.json`](red-team-raw-results.json) — not a number on a dashboard. (Full benchmark `results/YYYY-MM-DD.json` files are written locally per run and are gitignored.)

---

## Conceptual anchor: the Three Gulfs

This methodology is built on Hamel Husain & Shreya Shankar's **Three Gulfs** framework (Comprehension, Specification, Generalization), which is the industry-standard 2026 lens for LLM application evaluation:

1. **Comprehension gulf** — you cannot manually review every input/output. The benchmark addresses this by generating cases against documented diversity axes rather than ad-hoc.
2. **Specification gulf** — communicating intent precisely to the LLM is hard. The rubric (4 dimensions, 0-5 scale, isolated per-dimension judges, "Unknown" option) is the spec; the benchmark tests whether the spec holds.
3. **Generalization gulf** — model performance varies across inputs. Per-persona jaggedness reporting surfaces this directly: which models excel on which personas, where do all models fail.

References: [Anthropic — Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents); [Three Gulfs primer](https://www.davidokpare.com/blog/a-primer-to-evals); [Hamel Husain — LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/).

---

## Design hypotheses

For the rubric to be useful, each dimension must distinguish good responses from bad ones in specific, testable ways. Each hypothesis is paired with at least one adversarial case that should fail.

| ID | Hypothesis | Adversarial probe |
|----|-----------|-------------------|
| **H1** | A response with specific action + timeline + method scores actionability ≥ 4. A response saying "consider gaining more experience" scores ≤ 1. | `a05-vague-direction` |
| **H2** | A response that could apply to any candidate scores personalization ≤ 1. A response referencing the candidate's actual projects/experience scores ≥ 4. | `a01-generic-advice`, `a04-ignored-context` |
| **H3** | A response with definitive predictive claims ("you will definitely get this job") scores honesty ≤ 1. A response with calibrated uncertainty ("strong fit on X, harder to estimate Y") scores ≥ 4. | `a03-overconfident` |
| **H4** | A response citing credentials, jobs, or skills the user doesn't have scores grounding ≤ 1. A response where every factual claim is traceable to the resume scores ≥ 4. | `a02-hallucinated-credential` |

The benchmark fails on a dimension if the corresponding adversarial case scores higher than its `expected_max_score`, or if normal cases designed to demonstrate strong performance consistently score below 4.

---

## Scope: 275 cases (Planned)

> **Implementation status:** On disk today: 3 personas and N=6 runnable cases (5 in `cases/normal/`, 1 in `cases/adversarial/`), plus the 25-prompt red-team set in `red-team-prompts.json`. The canonical case inventory lives in [`COVERAGE.md`](COVERAGE.md). The 275/50/25 scope below is the **target design** the methodology is being built toward — not what currently ships. The next implementation milestone is the N=12 preregistered case set described in [`PM_DECISION_MEMO.md`](PM_DECISION_MEMO.md). Counts annotated **(Planned)** below until they exist on disk.

**50 synthetic personas** (`personas/*.json`) — none correspond to a real person. Each persona has a detailed resume text with enough surface area to ground responses against.

**250 normal cases** (Planned) (`cases/normal/*.json`) — 5 queries per persona, selected to exercise different rubric dimensions. Each response is generated through the real application code path (the `/api/query` route, not a mock). The judge scores it.

**25 adversarial cases** (Planned) (`cases/adversarial/*.json`) — each pairs a persona+query with a **deliberately bad response**, plus an `expected_max_score` for the dimension being tested. The judge scores the bad response. If the score exceeds the max, the rubric is broken on that dimension. The 25 red-team prompts in `red-team-prompts.json` (executed 2026-05-11 against production) are the empirical antecedent that the adversarial case set will be derived from.

This scale is large enough to support bootstrap confidence intervals on per-model and per-persona score deltas (which the smaller "20-case" benchmarks in many tutorials cannot defensibly provide).

---

## Persona generation: two-stage diversity axes

Naive prompting ("generate 50 diverse personas") causes mode collapse and stereotypical clustering — confirmed in 2026 work on synthetic persona generation ([DeepPersona](https://arxiv.org/html/2511.07338v3), [Persona Generators](https://arxiv.org/html/2602.03545v1)). The fix is two-stage generation with explicit diversity axes documented before generation:

**Stage 1 — Population-level diversity axes**

Personas are sampled across these axes simultaneously, not one at a time:

| Axis | Values |
|------|--------|
| Career stage | New grad / 1-2 yrs / 3-5 yrs / 5-10 yrs / 10+ yrs |
| Target role | AI APM / Forward Deployed Engineer / AI Engineer / Founding Engineer / Founder |
| Background origin | CS undergrad / non-CS undergrad / bootcamp / self-taught / career switcher / advanced degree |
| Domain depth | Generalist / vertical-specific (legal, medical, fintech, devtools, sales) |
| Geographic context | SV-based / NYC-based / EU / international / remote-only |
| Edge cases | Resume gaps / non-traditional path / self-taught / career re-entry |

**Stage 2 — Per-persona expansion**

Each persona is generated by sampling one value from each axis, then expanded into a full resume text. This produces diversity that survives statistical scrutiny (low Gini coefficient on persona attributes) and includes rare combinations that under-representative methods miss.

---

## Scoring: 0-5 scale, per-dimension isolated judges, "Unknown" option

Three research-backed methodology choices that depart from the original code:

1. **0-5 scale, not 1-5.** Recent peer-reviewed work ([arXiv 2601.03444](https://arxiv.org/html/2601.03444v1)) shows 0-5 yields the highest human-LLM alignment (highest ICC, lowest MAE) compared to 1-5 or 0-10. Trivial change with measurable impact.

2. **Per-dimension isolated judges, not single multi-dimension call.** Anthropic's official guidance: *"grade each dimension with an isolated LLM-as-judge rather than using one to grade all dimensions."* Each dimension gets its own focused judge call with its own rubric prompt. ~4× judge token cost per case, materially better calibration.

3. **"Unknown" option in every rubric.** Anthropic again: *"give the LLM a way out, like providing an instruction to return 'Unknown' when it doesn't have enough information."* Forces the judge to abstain on edge cases rather than guess. One line of prompt, large rigor gain.

Each dimension's rubric includes anchored examples at score 0, 2, and 4 to reduce evaluator variance.

---

## Judge architecture: primary single + council subset

A trade-off the field hasn't fully settled. Anthropic's research found single judge with structured rubric was *most consistent* with human judgment. The 2026 broader field favors **Panel of LLMs (PoLL) / "council of judges"** to reduce correlated blind spots across model families.

Resolution: run both, transparently.

**Primary path (every case, every dimension):**
- `anthropic/claude-opus-4.7` at temperature 0 (model IDs in this doc are OpenRouter slugs; canonical Anthropic identifier is `claude-opus-4-7`. Exact strings depend on OpenRouter catalog state at run time and are not yet verified against a live `/v1/models` query — first full run will surface any drift.)
- 4 judge calls per case (one per dimension), isolated
- Every case scored, full per-persona/per-model report

**Council validation (20% subset, randomly sampled with fixed seed `42` for cross-run reproducibility — same 55 cases every run, so score deltas reflect rubric/code changes, not sampling variance):**
- 3 judges: `anthropic/claude-opus-4.7`, `openai/gpt-5.4`, `google/gemini-3.1-pro`
- Same 4 isolated per-dimension calls each
- Aggregate inter-rater agreement reported via **Krippendorff's α** on ordinal scale
- α ≥ 0.8 = high confidence; 0.67-0.8 = treat tentatively; < 0.67 = rubric needs revision on that dimension

This gets the consistency Anthropic recommends *and* the cross-lab robustness check the broader 2026 field demands. Cost overhead from the council subset: ~30% on top of primary judge spend.

**Position bias mitigation:** the 20% subset is run twice with judge prompt order swapped. If scores diverge by > 0.5 points on average, position bias is flagged in the results.

---

## Generation: cross-model comparison via OpenRouter

The same 275 cases (Planned) are run through 5 generation models, all via OpenRouter (single SDK, unified API, ~30 min refactor of `getGenClient()`). The premium model IDs in the table below are illustrative/planned targets (see the model-roles note at the top), not models that have been run yet:

| Model | Tier | Why included |
|-------|------|--------------|
| `anthropic/claude-opus-4.7` | Premium reasoning | Anthropic frontier; baseline for "best possible" |
| `openai/gpt-5.4` | Premium structured | Different reasoning style; OpenAI frontier |
| `google/gemini-3.1-pro` | Premium multimodal | Different lab, different training distribution |
| `openai/gpt-4.1-nano` | Budget | The "cheap routing" option — proves cost-quality judgment |
| `deepseek/deepseek-v3` | Open-weights | Validates open ecosystem performance |

**Why fixed judge across all 5 generators:** varying the judge would invalidate the comparison. The judge is the rubric, not the variable. This is the single most important methodology decision — it's a constant across all generation experiments.

---

## Retrieval: embedding model comparison

Same 275 cases (Planned), same generation+judge pipeline, swapped embedding model on the retrieval step:

| Embedding | Source | Why test |
|-----------|--------|----------|
| `text-embedding-3-small` | OpenAI (current) | Baseline — what the pilot system used |
| `voyage-3-large` | Voyage AI | +10.58% vs `text-embedding-3-large` per published benchmarks |
| `embed-v4.0` | Cohere | Strong on long documents and multilingual |
| `gemini-embedding-001` | Google | Industry-leading on cross-lingual + multimodal |

Each embedding produces its own retrieval set; downstream generation + judging is held constant. The output: which embedding wins on **resume-text retrieval specifically** (not generic MTEB scores), at what cost, with what dimension trade-off.

This experiment is the basis for any future migration claim. "I tested 4 embeddings on my own benchmark and found Voyage-3-large lifted grounding by N%" is defensible. "I read a blog post and switched" is not.

---

## Adversarial cases: failure-mode taxonomy

The 25 adversarial cases (Planned) are mapped to a documented taxonomy aligned with [Agent-SafetyBench](https://venturebeat.com/security/frontier-models-are-failing-one-in-three-production-attempts-and-getting-harder-to-audit) and OS-HARM safety categories where they overlap.

| Category | Probe | Hypothesis |
|----------|-------|-----------|
| Generic advice (mode collapse) | a01-a05 | H2 — personalization should detect |
| Hallucinated credential (fabrication) | a06-a10 | H4 — grounding should detect |
| Overconfident prediction (calibration failure) | a11-a15 | H3 — honesty should detect |
| Ignored context (retrieval bypass) | a16-a20 | H2 — personalization should detect |
| Vague direction (actionability failure) | a21-a25 | H1 — actionability should detect |

Each adversarial case ships with `expected_max_score` for the targeted dimension. Test passes if the judge scores the bad response at or below the expected max.

---

## Statistical methods

Industry-standard 2026 practice for small/skewed eval sets:

- **Bootstrap confidence intervals** (10K resamples) on per-(model, dimension) means. Case-level resampling with replacement preserves persona structure (so CIs reflect sampling variability across cases, not within them). No claim of "model X scored higher than model Y" without non-overlapping CIs reported.
- **Krippendorff's α** for inter-rater agreement on the council subset, ordinal scoring on normal cases only. Target: α ≥ 0.8 high confidence; 0.67-0.8 treat tentatively; < 0.67 means the rubric needs revision on that dimension.
- **Adversarial pass-rate** as a separate binary metric — percentage of adversarial cases scoring at or below `expected_max_score`, per dimension.
- All raw scores preserved in `results/` so any reviewer can re-derive the statistics.

---

## What the output looks like

Every benchmark run produces `results/YYYY-MM-DD.json` with this shape:

```json
{
  "run_metadata": {
    "date": "2026-05-10",
    "total_cases": 275,
    "judges_used": ["claude-opus-4.7", "gpt-5.4", "gemini-3.1-pro"],
    "council_subset_size": 55,
    "krippendorff_alpha": { "actionability": 0.83, "personalization": 0.79, "honesty": 0.71, "grounding": 0.88 },
    "position_bias_check": { "max_score_drift": 0.21, "flag": false }
  },
  "per_model_scores": { /* mean + bootstrap CI per dimension per model */ },
  "per_persona_jaggedness": { /* model × persona heatmap */ },
  "adversarial_results": { /* expected_max vs observed_score per case */ },
  "rubric_health": { /* dimensions where adversarial cases passed/failed */ }
}
```

The "per-persona jaggedness map" surfaces which model wins on which persona archetype — the so-called **jagged frontier** of LLM capability, empirically measured on this domain instead of asserted.

---

## Falsifiability — when has the rubric failed this test?

The rubric is broken on a dimension if any of these are true:

1. The corresponding adversarial case scores higher than its `expected_max_score` (binary check; reported as adversarial pass-rate, NOT folded into Krippendorff's α).
2. Normal cases targeting strong performance on that dimension consistently score below 4.
3. Krippendorff's α on the council subset drops below 0.67 — applies to **ordinal scoring on normal cases only**. α is for ordinal inter-rater agreement; it is not the right metric for binary adversarial pass/fail.
4. Position bias flag triggers (max score drift > 0.5 across order-swapped runs on the council subset).
5. Adversarial pass-rate on a dimension drops below 80% (i.e., at least 4 of the 5 adversarial cases targeting that dimension must score at or below their `expected_max_score`).

Any failure triggers a rubric revision. The revision and its rationale get documented in [`docs/DECISION_LOG.md`](../../docs/DECISION_LOG.md) as a new dated entry, with the diff that fixed it referenced. This is the **bad-eval-to-good-eval cycle** from `docs/EVAL_DESIGN.md` operationalized as a runnable script.

---

## Cost + runtime budget

Per full run (275 cases (Planned) × ~11.4 LLM calls average × ~3K tokens per call ≈ 9.4M tokens):

- Generation across 5 models: ~$15-25
- Per-dimension primary judge (Claude Opus 4.7): ~$10-15
- Council validation on 20% subset (3 judges × 4 dims × 55 cases): ~$5-15
- Embedding comparison (4 models × 275 retrievals): ~$2-5
- **Total: ~$30-60 per full run**

Runtime: ~25-40 minutes with parallelism. The runner pools 10 concurrent requests per generation/judge model and respects OpenRouter tier rate limits (free tier: low RPM, expect ~40 min; paid tiers scale up substantially — check your account at https://openrouter.ai/settings/credits). The cost kill-switch (`--max-cost-usd`) aborts mid-run if projected total exceeds the cap, so a runaway long-context response from one model can't 5x the bill.

---

## Environment setup

The benchmark is a local development tool. All keys below live in `.env.local` (project root, gitignored). The early-2026 pilot's Vercel deployment only needed the keys the pilot app already used (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`); the benchmark-only keys stay local.

| Key | Required for | Where to get it |
|-----|--------------|-----------------|
| `OPENROUTER_API_KEY` | All generation + council judge calls (5 models routed through one API) | https://openrouter.ai/keys |
| `OPENAI_API_KEY` | Embedding comparison: text-embedding-3-small baseline | was already set for the pilot app |
| `VOYAGE_API_KEY` | Embedding comparison only | https://www.voyageai.com/ |
| `COHERE_API_KEY` | Embedding comparison only | https://dashboard.cohere.com/api-keys |
| `GEMINI_API_KEY` | Embedding comparison only | https://aistudio.google.com/apikey |

Skip the embedding keys to run the core benchmark (generation + judging) without the embedding-comparison experiment.

## How to run

```bash
# Smoke test FIRST on every fresh setup: 5 cases x 1 model x no council, ~$0.10, ~2 min.
# Validates auth + retrieval + judge flow before spending real money on a full run.
node scripts/run-eval-benchmark.cjs --smoke

# Dry run: validates env keys + lists what would run, no API calls, no spend.
# NOTE: --dry-run, --max-cost-usd, and --experiment are documented design targets
# but not yet implemented in the current runner (see script preamble). The smoke
# path validates the pipeline end-to-end; full-run + experiment flags land later.
node scripts/run-eval-benchmark.cjs --dry-run       # (Planned)
node scripts/run-eval-benchmark.cjs --max-cost-usd=50  # (Planned)
node scripts/run-eval-benchmark.cjs --experiment=cross-model  # (Planned)
node scripts/run-eval-benchmark.cjs --experiment=embedding    # (Planned)
node scripts/run-eval-benchmark.cjs --experiment=council      # (Planned)
```

The runner:
1. Loads all personas + cases
2. Validates env keys against requested experiments before spending tokens
3. For each case, calls each generation model via OpenRouter with a configurable concurrency pool (default 10), respecting OpenRouter tier rate limits
4. For each generated response, calls each judge per dimension (isolated per-dimension calls)
5. **Robustness:** transient failures (HTTP 429, 5xx, timeouts) trigger exponential backoff with max 3 retries. Malformed JSON from a judge after 3 retries is logged and the case is marked `judge_skipped` rather than failing the entire run.
6. Computes statistics: bootstrap CIs on ordinal scores, Krippendorff's α on the council subset, adversarial pass-rate as a separate binary metric
7. Writes `results/YYYY-MM-DD.json`

During the early-2026 pilot, the deployed product's eval scores were written to the Supabase `evals` table and inspected via direct queries — separate from these benchmark results files; that pilot backend is no longer accessible. (An earlier unauthenticated `/admin/evals` view was removed before release.) The per-persona jaggedness visualization on top of benchmark results is on the post-v3 roadmap, not yet shipped.

---

## What this benchmark deliberately doesn't measure

Intellectual honesty requires documenting limitations:

- **Real-user satisfaction** — no users involved in the benchmark itself. User research is not yet documented in this repo and would be a separate work stream from this rubric validation.
- **Long-term outcome correlation** — the benchmark measures response quality, not whether users who acted on the responses got jobs. That's a longitudinal study that requires production telemetry over months.
- **Cases outside the 5 persona archetypes** (non-English resumes, non-tech roles, executive transitions). The 50-persona sample covers most early-career-to-mid-career tech personas, not all candidate populations.
- **Tone, fluency, grammar** — rejected as criteria upstream in `docs/EVAL_DESIGN.md`. The benchmark does not score for these.
- **Strategic correctness** — advice can be well-grounded and actionable but strategically wrong (e.g., recommending a dying industry). The rubric does not test this.

### v2 refinements pending empirical data

The eng review (May 2026) flagged three methodology refinements that need first-run data before being decided. Documented here so future iterations know what to revisit:

- **Embedding comparison confounds retrieval and generation quality.** Each embedding produces its own retrieval set, so the LLM gets different context, so the grounding score reflects BOTH retrieval AND generation. v2 should add a retrieval-only metric (recall@k against gold-standard chunks per persona) to isolate embedding impact from generation impact. Deferred pending first-run data: once we have baseline grounding scores per embedding, the right shape for gold-standard chunks becomes clearer.

- **"Strategic correctness" limitation overlaps with Honesty rubric.** Honesty already penalizes definitive predictive claims about uncertain outcomes ("you will definitely get this job"). The strategic-correctness disclaimer in the section above may mislead readers about what Honesty does cover. v2 should either clarify the boundary with concrete examples or remove the limitation as redundant. Deferred pending first-run data: once judge reasoning on adversarial honesty cases is visible, the right boundary will be clearer.

- **Token estimate (~3K per call) is unverified.** Cost projections assume ~3K tokens per call across all judge + generation calls. Real distribution is likely 5-8K average (judge calls with 6 retrieved chunks + full response can be 8-12K). v2 should replace the round-number estimate with measured per-(model, dimension) averages from the first full benchmark run.

---

## Versioning + iteration cycle

Results are dated. Re-running the benchmark on the same code generates a new dated results file. Every architectural change (RAG upgrade, prompt rewrite, model swap, embedding migration) **must** be paired with a benchmark re-run, with both before/after results files retained. Score deltas without a corresponding code change indicate judge variance and trigger a position bias check.

A score delta on an unchanged rubric is a regression. A score delta after a deliberate rubric change is the unit of progress.

The discipline is to build the eval first, then use it to validate every architectural change. A score delta with no corresponding code change is treated as judge variance to investigate, not as progress to claim.

---

## What to read next

- [`docs/EVAL_DESIGN.md`](../../docs/EVAL_DESIGN.md) — why these 4 dimensions, how the rubric was designed, what it deliberately doesn't measure
- [`docs/DECISION_LOG.md`](../../docs/DECISION_LOG.md) — historical decisions, including any rubric revisions triggered by this benchmark
- [`lib/evals/coaching-quality.ts`](../../lib/evals/coaching-quality.ts) — the rubric implementation
- [Anthropic — Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Hamel Husain & Shreya Shankar — AI Evals For Engineers & PMs](https://maven.com/parlance-labs/evals)
- [Grading Scale Impact on LLM-as-a-Judge (arXiv 2601.03444)](https://arxiv.org/html/2601.03444v1)
- [Agent-SafetyBench / OS-HARM safety taxonomies](https://venturebeat.com/security/frontier-models-are-failing-one-in-three-production-attempts-and-getting-harder-to-audit)
