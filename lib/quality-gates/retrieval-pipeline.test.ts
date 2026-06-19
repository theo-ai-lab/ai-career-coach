/**
 * Unit tests for quality-gates/retrieval-pipeline.
 * Mock embed/retrieve + mock vectors only — no DB, no key.
 * Run: npx tsx --test lib/quality-gates/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runRetrievalPipeline,
  expandQueryWithProfile,
  type RetrievedDoc,
  type EmbedFn,
  type RetrieveFn,
} from './retrieval-pipeline';

function docs(...sims: number[]): RetrievedDoc[] {
  return sims.map((s, i) => ({ content: `chunk ${i} sim ${s}`, similarity: s }));
}

/** An embed/retrieve pair that records how often each was called. */
function spies(opts: {
  refinedEmbedding: number[];
  reretrieved?: RetrievedDoc[];
}) {
  const calls = { embed: 0, retrieve: 0 };
  const embed: EmbedFn = async () => {
    calls.embed++;
    return opts.refinedEmbedding;
  };
  const retrieve: RetrieveFn = async () => {
    calls.retrieve++;
    return opts.reretrieved ?? [];
  };
  return { calls, embed, retrieve };
}

test('dense first page -> no re-retrieval considered, no embed/retrieve calls', async () => {
  const { calls, embed, retrieve } = spies({ refinedEmbedding: [0, 1] });
  const result = await runRetrievalPipeline({
    query: 'summarize my background',
    refinedQuery: 'summarize my background OpenAI APM',
    initialDocs: docs(0.9, 0.85, 0.8),
    queryEmbedding: [1, 0],
    embed,
    retrieve,
  });
  assert.equal(result.density.region, 'dense');
  assert.equal(result.reretrieval.attempted, false);
  assert.equal(result.reretrieval.fired, false);
  assert.equal(calls.embed, 0);
  assert.equal(calls.retrieve, 0);
  assert.equal(result.docs.length, 3);
});

test('refinedQuery equal to query -> not considered', async () => {
  const { calls, embed, retrieve } = spies({ refinedEmbedding: [0, 1] });
  const result = await runRetrievalPipeline({
    query: 'tell me about my projects',
    refinedQuery: '  tell me about my projects  ', // same after trim
    initialDocs: docs(0.45, 0.45, 0.45), // borderline
    queryEmbedding: [1, 0],
    embed,
    retrieve,
  });
  assert.equal(result.initialDensity.region, 'borderline');
  assert.equal(result.reretrieval.attempted, false);
  assert.equal(calls.embed, 0);
  assert.equal(calls.retrieve, 0);
});

test('borderline + low-novelty reformulation -> reuse, saves the retrieval call', async () => {
  // Reformulation only reorders existing tokens (covered by prior text) and
  // the embedding barely moves -> info gain below threshold -> reuse.
  const { calls, embed, retrieve } = spies({ refinedEmbedding: [1, 0.001] });
  const result = await runRetrievalPipeline({
    query: 'improve resume wording',
    refinedQuery: 'resume wording improve clarity', // 'clarity' is the only new token
    initialDocs: [
      { content: 'resume wording improve clarity polish bullet points', similarity: 0.45 },
      { content: 'clarity wording resume', similarity: 0.45 },
    ],
    queryEmbedding: [1, 0],
    embed,
    retrieve,
  });
  assert.equal(result.reretrieval.attempted, true);
  assert.equal(result.reretrieval.fired, false);
  assert.equal(result.reretrieval.savedCall, true);
  assert.equal(calls.embed, 1); // one embed to measure drift
  assert.equal(calls.retrieve, 0); // but the vector search was skipped
  assert.equal(result.docs.length, 2); // original docs stand
});

test('borderline + novel reformulation that retrieves denser -> fires and adopts', async () => {
  const { calls, embed, retrieve } = spies({
    refinedEmbedding: [0, 1], // orthogonal -> high drift
    reretrieved: docs(0.92, 0.9, 0.88), // denser
  });
  const result = await runRetrievalPipeline({
    query: 'what should I learn next',
    refinedQuery: 'kubernetes terraform distributed systems mentorship',
    initialDocs: docs(0.5, 0.45, 0.4), // borderline
    queryEmbedding: [1, 0],
    embed,
    retrieve,
  });
  assert.equal(result.reretrieval.attempted, true);
  assert.equal(result.reretrieval.fired, true);
  assert.equal(result.reretrieval.savedCall, false);
  assert.equal(result.reretrieval.improved, true);
  assert.equal(result.density.region, 'dense'); // adopted the denser page
  assert.equal(calls.embed, 1);
  assert.equal(calls.retrieve, 1);
  assert.ok(result.reretrieval.infoGain && result.reretrieval.infoGain >= 0.25);
});

test('sparse first page forces a re-fire even if drift/novelty are low', async () => {
  // requiresMoreEvidence is raised on a sparse page; a distinct reformulation
  // re-fires regardless of the info-gain score.
  const { calls, embed, retrieve } = spies({
    refinedEmbedding: [1, 0.0005], // near-parallel -> ~0 drift
    reretrieved: docs(0.8, 0.75, 0.7), // denser
  });
  const result = await runRetrievalPipeline({
    query: 'salary advice',
    refinedQuery: 'salary advice negotiation', // only one extra token
    initialDocs: docs(0.2, 0.15, 0.1), // sparse
    queryEmbedding: [1, 0],
    embed,
    retrieve,
  });
  assert.equal(result.initialDensity.region, 'sparse');
  assert.equal(result.reretrieval.fired, true);
  assert.equal(result.reretrieval.improved, true);
  assert.equal(result.density.region, 'dense');
  assert.equal(calls.retrieve, 1);
});

test('fired but re-retrieval is not denser -> keep the original docs', async () => {
  const { embed, retrieve } = spies({
    refinedEmbedding: [0, 1], // high drift -> fires
    reretrieved: docs(0.1, 0.05), // even sparser than the original
  });
  const result = await runRetrievalPipeline({
    query: 'tell me something',
    refinedQuery: 'completely unrelated astrophysics topics here',
    initialDocs: docs(0.25, 0.22, 0.2), // sparse
    queryEmbedding: [1, 0],
    embed,
    retrieve,
  });
  assert.equal(result.reretrieval.fired, true);
  assert.equal(result.reretrieval.improved, false);
  // Original (less-bad) docs are kept; density reflects the original page.
  assert.equal(result.docs[0].similarity, 0.25);
  assert.equal(
    result.density.meanNeighborSimilarity,
    result.initialDensity.meanNeighborSimilarity,
  );
});

test('empty first page -> sparse, no re-retrieval considered', async () => {
  const { calls, embed, retrieve } = spies({ refinedEmbedding: [0, 1] });
  const result = await runRetrievalPipeline({
    query: 'anything',
    refinedQuery: 'anything more specific here',
    initialDocs: [],
    queryEmbedding: [1, 0],
    embed,
    retrieve,
  });
  assert.equal(result.density.region, 'sparse');
  assert.equal(result.reretrieval.attempted, false);
  assert.equal(calls.embed, 0);
  assert.equal(calls.retrieve, 0);
});

// ---- expandQueryWithProfile -------------------------------------------------

test('expandQueryWithProfile: null profile returns the query unchanged', () => {
  assert.equal(expandQueryWithProfile('improve my resume', null), 'improve my resume');
  assert.equal(expandQueryWithProfile('improve my resume', undefined), 'improve my resume');
});

test('expandQueryWithProfile: appends profile terms not already present', () => {
  const out = expandQueryWithProfile('how do I prepare', {
    target_role: 'APM',
    target_companies: ['OpenAI'],
    skills: ['RAG', 'evals'],
  });
  assert.match(out, /^how do I prepare /);
  assert.ok(out.includes('APM'));
  assert.ok(out.includes('OpenAI'));
  assert.ok(out.includes('RAG'));
  assert.ok(out.includes('evals'));
});

test('expandQueryWithProfile: terms already in the query are not duplicated', () => {
  const out = expandQueryWithProfile('how do I get an APM role at OpenAI', {
    target_role: 'APM',
    target_companies: ['OpenAI'],
  });
  // Nothing new to add -> unchanged (the gate will then decline to re-retrieve).
  assert.equal(out, 'how do I get an APM role at OpenAI');
});

test('expandQueryWithProfile: de-duplicates repeated profile terms', () => {
  const out = expandQueryWithProfile('plan my next steps', {
    target_role: 'PM',
    target_companies: ['PM'], // duplicate term
    skills: ['PM'],
  });
  const occurrences = out.split(/\s+/).filter((t) => t === 'PM').length;
  assert.equal(occurrences, 1);
});
