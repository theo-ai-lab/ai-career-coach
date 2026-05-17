/**
 * Synthetic eval benchmark runner.
 *
 * SMOKE MODE ONLY (current scaffold).
 *
 * Pure CJS + native fetch. No tsx, no @langchain/openai, no openai SDK.
 * Background: @langchain/openai under tsx and the openai v6.10.0 SDK both
 * hang on module load in this Node 24.11.1 environment. fetch is built-in
 * and avoids both. Production runner (v2) will revisit SDK choice.
 *
 * What smoke validates:
 *   - Persona JSON loading from data/eval-benchmark/personas/
 *   - Case JSON loading from data/eval-benchmark/cases/normal/
 *   - Generation flow (resume context + query -> response)
 *   - Judge flow (response + contexts -> rubric scores)
 *   - Results file shape + write to data/eval-benchmark/results/
 *
 * Caveats vs production methodology (data/eval-benchmark/README.md):
 *   - Single-call judge returning all 4 scores. Production calls for per-dimension
 *     isolated judges per Anthropic guidance. v2 will migrate.
 *   - 1-5 scoring (matches existing lib/evals/coaching-quality.ts). Production
 *     migrates to 0-5 with "Unknown" option in v2.
 *   - Direct OpenAI HTTPS via fetch (bypasses langchain TLA hang + openai SDK
 *     v6 module-load hang). Production will use OpenRouter for cross-model.
 *   - No council validation, no Krippendorff alpha, no bootstrap CIs, no position
 *     bias check. Smoke validates pipeline only.
 *
 * NOT YET IMPLEMENTED (will return error):
 *   --dry-run        validate env, list what would run, no API calls
 *   --max-cost-usd   cost kill-switch
 *   --experiment     run a single experiment (cross-model | embedding | council)
 *
 * Run:
 *   node scripts/run-eval-benchmark.cjs --smoke
 *   node scripts/run-eval-benchmark.cjs --smoke --per-dim-judge
 *   node scripts/run-eval-benchmark.cjs --smoke --judge-provider=openrouter --judge-model=<provider/model>
 *   (the cross-provider flag combines with --per-dim-judge for per-dimension cross-provider judging)
 *
 * Default is single-call judge (one call returning all 4 scores). The
 * --per-dim-judge flag opts into isolated per-dimension judge calls (4 calls
 * per case), which removes rubric cross-contamination at ~4x judge cost.
 * The --judge-provider=openrouter flag routes judge calls through an
 * alternate provider to reduce same-model self-grading bias. Generation
 * always stays on the default provider. Requires OPENROUTER_API_KEY in
 * .env.local and an explicit --judge-model=<slug>. No model slug is
 * hardcoded in this file.
 */

const { readFile, readdir, writeFile, mkdir } = require('fs/promises');
const { join, resolve } = require('path');

require('dotenv').config({ path: resolve(__dirname, '..', '.env.local') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY missing from .env.local');
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.includes('--smoke')) {
  console.error('Smoke-only scaffold. Pass --smoke to run.');
  console.error('--dry-run, --max-cost-usd, --experiment are stubs; v2 will implement them.');
  process.exit(1);
}

const perDimJudge = args.includes('--per-dim-judge');
const JUDGE_MODE = perDimJudge ? 'per_dimension' : 'single_call';

function getArgValue(prefix) {
  const a = args.find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
}
const judgeProvider = getArgValue('--judge-provider=') || 'openai';
const judgeModelOverride = getArgValue('--judge-model=');

if (judgeProvider !== 'openai' && judgeProvider !== 'openrouter') {
  console.error(`FATAL: --judge-provider must be "openai" or "openrouter" (got "${judgeProvider}")`);
  process.exit(1);
}

if (judgeProvider === 'openrouter') {
  if (!judgeModelOverride) {
    console.error('FATAL: --judge-provider=openrouter requires --judge-model=<provider/model>');
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('FATAL: --judge-provider=openrouter requires OPENROUTER_API_KEY in .env.local (see .env.example).');
    process.exit(1);
  }
}

const ROOT = resolve(__dirname, '..');
const BENCHMARK_DIR = resolve(ROOT, 'data/eval-benchmark');
const PERSONAS_DIR = join(BENCHMARK_DIR, 'personas');
const CASES_DIR = join(BENCHMARK_DIR, 'cases', 'normal');
const RESULTS_DIR = join(BENCHMARK_DIR, 'results');

const GEN_MODEL = 'gpt-4o-mini';
const GEN_TEMP = 0.2;
const JUDGE_MODEL = 'gpt-4o-mini';
const JUDGE_TEMP = 0;
// Effective judge model: the hardcoded default for the openai path,
// or the user-supplied --judge-model=<slug> for the openrouter path.
// No specific cross-provider slug is hardcoded in this file.
const JUDGE_MODEL_EFFECTIVE = judgeProvider === 'openrouter' ? judgeModelOverride : JUDGE_MODEL;

async function chatCompletion({ model, temperature, messages, provider = 'openai' }) {
  let url;
  let key;
  if (provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    key = process.env.OPENROUTER_API_KEY;
  } else {
    url = 'https://api.openai.com/v1/chat/completions';
    key = OPENAI_API_KEY;
  }
  const body = { model, temperature, messages };
  if (provider === 'openrouter') {
    // Cap max output so the provider does not pre-authorize against the
    // model's full output window for cost-reservation purposes. Judge
    // responses are short JSON; 1024 is ample headroom.
    body.max_tokens = 1024;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${provider} ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.choices[0].message.content ?? '';
}

async function loadJson(path) {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

async function loadAllPersonas() {
  const files = (await readdir(PERSONAS_DIR)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map((f) => loadJson(join(PERSONAS_DIR, f))));
}

async function loadAllCases() {
  const files = (await readdir(CASES_DIR)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map((f) => loadJson(join(CASES_DIR, f))));
}

async function generateResponse(persona, query) {
  return chatCompletion({
    model: GEN_MODEL,
    temperature: GEN_TEMP,
    messages: [
      {
        role: 'system',
        content: `You are an expert AI career coach. Use ONLY the following resume context to answer:\n\n${persona.resume_text}\n\nAnswer concisely, professionally, and confidently. Never hallucinate. Ground every claim in the resume.`,
      },
      { role: 'user', content: query },
    ],
  });
}

async function judgeResponse(query, response, contexts) {
  const contextsText = contexts.map((c, i) => `[Context ${i + 1}]\n${c}`).join('\n\n');
  const prompt = `You are an expert evaluator of AI coaching responses. Evaluate the following coaching response on 4 criteria, each scored 1-5.

USER QUERY:
${query}

RETRIEVED CONTEXTS:
${contextsText}

COACHING RESPONSE TO EVALUATE:
${response}

EVALUATION CRITERIA:

1. ACTIONABILITY (1-5): Can the user act on this advice within 48 hours?
   - 5: Specific action + timeline + method
   - 3: Action category without specifics
   - 1: Pure platitude

2. PERSONALIZATION (1-5): Is this specific to their resume, not generic advice?
   - 5: References specific experiences/projects from contexts
   - 3: Acknowledges field/level but semi-generic
   - 1: Could apply to anyone

3. HONESTY (1-5): Does it acknowledge uncertainty appropriately?
   - 5: Clear confidence calibration where warranted
   - 3: Doesn't overclaim but no explicit uncertainty
   - 1: Definitive predictive claims about unknowable things

4. GROUNDING (1-5): Is every claim about the user traceable to the context?
   - 5: Every claim verifiable in context
   - 3: Mostly grounded with minor reasonable extrapolation
   - 1: Significant hallucination

OUTPUT FORMAT:
Return ONLY valid JSON, no markdown:
{
  "scores": {
    "actionability": <1-5>,
    "personalization": <1-5>,
    "honesty": <1-5>,
    "grounding": <1-5>
  },
  "reasoning": "<brief explanation, 2-3 sentences>",
  "overall": <0-100, average of the 4 scores scaled to 0-100>
}`;

  const raw = await chatCompletion({
    model: JUDGE_MODEL_EFFECTIVE,
    temperature: JUDGE_TEMP,
    messages: [{ role: 'user', content: prompt }],
    provider: judgeProvider,
  });

  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in judge response: ${raw}`);

  const result = JSON.parse(match[0]);

  const avg =
    (result.scores.actionability +
      result.scores.personalization +
      result.scores.honesty +
      result.scores.grounding) /
    4;
  result.overall = Math.round((avg / 5) * 100);

  return result;
}

// Per-dimension judge path (opt-in via --per-dim-judge).
//
// Each dimension gets an isolated single-criterion prompt and its own
// completion call. This removes the rubric cross-contamination that the
// single-call judge produces (e.g., penalizing actionability on a case
// whose target dimension is honesty).
//
// Same model, same temperature as the single-call path. Cost scales 4x
// per case. Overall score formula is unchanged: average of the 4 scores
// scaled to 0-100.

const RUBRIC_BY_DIM = {
  actionability: `ACTIONABILITY (1-5): Can the user act on this advice within 48 hours?
- 5: Specific action + timeline + method
- 3: Action category without specifics
- 1: Pure platitude`,
  personalization: `PERSONALIZATION (1-5): Is this specific to the resume, not generic advice?
- 5: References specific experiences/projects from contexts
- 3: Acknowledges field/level but semi-generic
- 1: Could apply to anyone`,
  honesty: `HONESTY (1-5): Does it acknowledge uncertainty appropriately?
- 5: Clear confidence calibration where warranted
- 3: Doesn't overclaim but no explicit uncertainty
- 1: Definitive predictive claims about unknowable things`,
  grounding: `GROUNDING (1-5): Is every claim about the user traceable to the context?
- 5: Every claim verifiable in context
- 3: Mostly grounded with minor reasonable extrapolation
- 1: Significant hallucination`,
};

async function judgeOneDim(dim, query, response, contexts) {
  const contextsText = contexts.map((c, i) => `[Context ${i + 1}]\n${c}`).join('\n\n');
  const prompt = `You are an expert evaluator of AI coaching responses. Evaluate the following coaching response ONLY on the single criterion below.

USER QUERY:
${query}

RETRIEVED CONTEXTS:
${contextsText}

COACHING RESPONSE TO EVALUATE:
${response}

EVALUATION CRITERION:

${RUBRIC_BY_DIM[dim]}

OUTPUT FORMAT:
Return ONLY valid JSON, no markdown:
{
  "score": <1-5>,
  "reasoning": "<brief explanation, 1-2 sentences>"
}`;

  const raw = await chatCompletion({
    model: JUDGE_MODEL_EFFECTIVE,
    temperature: JUDGE_TEMP,
    messages: [{ role: 'user', content: prompt }],
    provider: judgeProvider,
  });

  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in ${dim} judge response: ${raw}`);

  const parsed = JSON.parse(match[0]);
  if (typeof parsed.score !== 'number' || parsed.score < 1 || parsed.score > 5) {
    throw new Error(`Invalid ${dim} score: ${parsed.score}`);
  }
  return { score: parsed.score, reasoning: String(parsed.reasoning ?? '') };
}

async function judgeResponsePerDim(query, response, contexts) {
  const dims = ['actionability', 'personalization', 'honesty', 'grounding'];
  // Parallel: 4 isolated calls. Each only sees its own rubric.
  const out = await Promise.all(
    dims.map((d) => judgeOneDim(d, query, response, contexts))
  );
  const scores = {};
  const per_dim_reasoning = {};
  dims.forEach((d, i) => {
    scores[d] = out[i].score;
    per_dim_reasoning[d] = out[i].reasoning;
  });
  const avg =
    (scores.actionability +
      scores.personalization +
      scores.honesty +
      scores.grounding) /
    4;
  const overall = Math.round((avg / 5) * 100);
  return { scores, per_dim_reasoning, overall };
}

async function main() {
  console.log('SMOKE RUN STARTING');
  console.log(`  Generation: ${GEN_MODEL} (temp ${GEN_TEMP})`);
  console.log(`  Judge: ${JUDGE_MODEL_EFFECTIVE} (temp ${JUDGE_TEMP})`);
  console.log(`  Judge mode: ${JUDGE_MODE}${perDimJudge ? ' (4 isolated calls per case, ~4x cost)' : ''}`);
  console.log(`  Judge transport: ${judgeProvider}`);
  console.log('  Mode: smoke (~$0.05-0.10, ~2 min)');
  console.log('');

  const personas = await loadAllPersonas();
  const cases = await loadAllCases();
  console.log(`Loaded ${personas.length} personas, ${cases.length} cases`);
  console.log('');

  const results = [];

  for (const c of cases) {
    const persona = personas.find((p) => p.id === c.persona_id);
    if (!persona) {
      console.error(`SKIP: no persona ${c.persona_id} found for case ${c.id}`);
      continue;
    }

    console.log(`Case: ${c.id}`);
    console.log(`  Persona: ${persona.id} (${persona.label})`);
    console.log(`  Query: ${c.query.slice(0, 80)}...`);
    console.log(`  Expected dimension focus: ${c.expected_dimension_focus}`);

    const genStart = Date.now();
    const response = await generateResponse(persona, c.query);
    const genTimeS = (Date.now() - genStart) / 1000;
    console.log(`  Response generated: ${genTimeS.toFixed(1)}s, ${response.length} chars`);

    const judgeStart = Date.now();
    const judgement = perDimJudge
      ? await judgeResponsePerDim(c.query, response, [persona.resume_text])
      : await judgeResponse(c.query, response, [persona.resume_text]);
    const judgeTimeS = (Date.now() - judgeStart) / 1000;
    console.log(`  Judged: ${judgeTimeS.toFixed(1)}s | overall ${judgement.overall}/100`);
    console.log(`    actionability: ${judgement.scores.actionability}/5`);
    console.log(`    personalization: ${judgement.scores.personalization}/5`);
    console.log(`    honesty: ${judgement.scores.honesty}/5`);
    console.log(`    grounding: ${judgement.scores.grounding}/5`);
    console.log('');

    const caseResult = {
      case_id: c.id,
      persona_id: persona.id,
      persona_label: persona.label,
      query: c.query,
      expected_dimension_focus: c.expected_dimension_focus,
      response,
      scores: judgement.scores,
      overall: judgement.overall,
      reasoning: perDimJudge
        ? '(per-dimension mode — see per_dim_reasoning)'
        : judgement.reasoning,
      gen_time_s: Number(genTimeS.toFixed(2)),
      judge_time_s: Number(judgeTimeS.toFixed(2)),
      timestamp: new Date().toISOString(),
    };
    if (judgement.per_dim_reasoning) {
      caseResult.per_dim_reasoning = judgement.per_dim_reasoning;
    }
    results.push(caseResult);
  }

  const judgeCaveat = perDimJudge
    ? (judgeProvider === 'openrouter'
        ? 'Per-dimension isolated judges active with cross-provider transport. Independent judge model reduces same-model self-grading bias.'
        : 'Per-dimension isolated judges active. Same model as the generator; cross-model judging is the next planned improvement to address grounding self-grading bias.')
    : (judgeProvider === 'openrouter'
        ? 'Single-call judge with cross-provider transport. Independent judge model reduces same-model self-grading bias.'
        : 'Single-call judge returning all 4 scores. Production methodology requires per-dimension isolated judges per Anthropic eval guidance. v2.');

  const summary = {
    run_metadata: {
      mode: 'smoke',
      date: new Date().toISOString().split('T')[0],
      generation_model: GEN_MODEL,
      generation_temperature: GEN_TEMP,
      judge_model: JUDGE_MODEL,
      judge_temperature: JUDGE_TEMP,
      judge_mode: JUDGE_MODE,
      judge_transport: judgeProvider,
      judge_model_effective: JUDGE_MODEL_EFFECTIVE,
      transport: 'native fetch (CJS, no SDK)',
      total_personas_loaded: personas.length,
      total_cases_run: results.length,
      smoke_caveats: [
        judgeCaveat,
        '1-5 scoring inherited from existing lib/evals/coaching-quality.ts. Production methodology migrates to 0-5 with "Unknown" option in v2.',
        'Native fetch over HTTPS (bypasses @langchain/openai TLA hang and openai SDK v6 module-load hang on Node 24.11.1 / tsx 4.21). Production runner will use OpenRouter for cross-model comparison. v2.',
        'No council validation, no Krippendorff alpha, no bootstrap CIs, no position bias check. Smoke validates pipeline only.',
      ],
    },
    per_case_results: results,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const perDimTag = perDimJudge ? '-perdim' : '';
  const providerTag = judgeProvider === 'openrouter' ? '-xprovider' : '';
  const outFile = `2026-05-10-smoke${perDimTag}${providerTag}.json`;
  const outPath = join(RESULTS_DIR, outFile);
  await writeFile(outPath, JSON.stringify(summary, null, 2));

  console.log('---');
  console.log('SMOKE COMPLETE');
  console.log(`  Results written: ${outPath}`);
  console.log(`  Cases run: ${results.length}`);
  if (results.length > 0) {
    const avg = results.reduce((s, r) => s + r.overall, 0) / results.length;
    console.log(`  Average overall: ${Math.round(avg)}/100`);
  }
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
