/**
 * Unit tests for quality-gates/satisficing.
 * Mock judge output / mock generator+judge — no LLM, no key.
 * Run: npx tsx --test lib/quality-gates/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateSatisficing,
  runSatisficingLoop,
  DEFAULT_SATISFICING_CRITERIA,
  type AnswerGenerator,
  type QualityJudge,
} from './satisficing';
import type {
  CoachingQualityOutput,
  CoachingQualityScores,
} from '@/lib/evals/coaching-quality';

/**
 * Build a mock judge output. `overall` and `scores` are set independently
 * on purpose so we can isolate the floor logic from the average logic — the
 * decision under test reads both fields, it does not recompute `overall`.
 */
function judgeOut(
  overall: number,
  scores: Partial<CoachingQualityScores> = {},
): CoachingQualityOutput {
  return {
    overall,
    scores: {
      actionability: scores.actionability ?? 4,
      personalization: scores.personalization ?? 4,
      honesty: scores.honesty ?? 4,
      grounding: scores.grounding ?? 4,
    },
    reasoning: 'mock',
  };
}

test('satisficed: overall >= target and floors met -> stop early', () => {
  const d = evaluateSatisficing(judgeOut(84, { honesty: 4, grounding: 5 }), {
    iteration: 1,
  });
  assert.equal(d.stop, true);
  assert.equal(d.reason, 'satisficed');
  assert.equal(d.meetsQualityBar, true);
  assert.deepEqual(d.failedFloors, []);
});

test('high overall but grounding below floor -> NOT satisficed (continue on iter 1)', () => {
  const d = evaluateSatisficing(judgeOut(90, { grounding: 3 }), { iteration: 1 });
  assert.equal(d.meetsQualityBar, false);
  assert.deepEqual(d.failedFloors, ['grounding']);
  // iteration 1, no previous -> not diminishing, not max -> continue
  assert.equal(d.stop, false);
  assert.equal(d.reason, 'continue');
});

test('safety floors block a slick-but-ungrounded answer (honesty + grounding)', () => {
  const d = evaluateSatisficing(
    judgeOut(95, { actionability: 5, personalization: 5, honesty: 2, grounding: 2 }),
    { iteration: 1 },
  );
  assert.equal(d.meetsQualityBar, false);
  assert.deepEqual(d.failedFloors.sort(), ['grounding', 'honesty']);
});

test('diminishing returns: small delta below the bar -> stop', () => {
  const d = evaluateSatisficing(judgeOut(71), {
    iteration: 2,
    previousOverall: 70,
  });
  assert.equal(d.stop, true);
  assert.equal(d.reason, 'diminishing-returns');
  assert.equal(d.delta, 1);
});

test('healthy improvement below the bar -> continue', () => {
  const d = evaluateSatisficing(judgeOut(75), {
    iteration: 2,
    previousOverall: 65,
  });
  assert.equal(d.stop, false);
  assert.equal(d.reason, 'continue');
  assert.equal(d.delta, 10);
});

test('max-iterations backstop: never satisfices -> stop, not meeting bar', () => {
  const d = evaluateSatisficing(judgeOut(60), {
    iteration: DEFAULT_SATISFICING_CRITERIA.maxIterations,
    previousOverall: 50, // delta 10, so NOT diminishing returns
  });
  assert.equal(d.stop, true);
  assert.equal(d.reason, 'max-iterations');
  assert.equal(d.meetsQualityBar, false);
});

test('satisficing takes priority over max-iterations at the last iteration', () => {
  const d = evaluateSatisficing(judgeOut(88), {
    iteration: DEFAULT_SATISFICING_CRITERIA.maxIterations,
    previousOverall: 80,
  });
  assert.equal(d.reason, 'satisficed');
});

test('custom criteria: higher target keeps the loop going', () => {
  const d = evaluateSatisficing(judgeOut(82), { iteration: 1 }, { overallTarget: 90 });
  assert.equal(d.meetsQualityBar, false);
  assert.equal(d.reason, 'continue');
});

// ---- full loop with injected mock generator + judge ----

function mockGenerator(): AnswerGenerator {
  return {
    async generate({ iteration }) {
      return `draft v${iteration}`;
    },
  };
}

/** Judge that returns a scripted overall per iteration. */
function scriptedJudge(
  script: Array<{ overall: number; scores?: Partial<CoachingQualityScores> }>,
): QualityJudge {
  let i = 0;
  return {
    async evaluate() {
      const step = script[Math.min(i, script.length - 1)];
      i++;
      return judgeOut(step.overall, step.scores);
    },
  };
}

test('runSatisficingLoop: stops as soon as it satisfices (iteration 2)', async () => {
  const result = await runSatisficingLoop({
    generator: mockGenerator(),
    judge: scriptedJudge([
      { overall: 62, scores: { grounding: 3 } }, // iter1: below bar -> continue
      { overall: 83, scores: { honesty: 4, grounding: 4 } }, // iter2: satisfices
      { overall: 99 }, // would never be reached
    ]),
  });
  assert.equal(result.iterations, 2);
  assert.equal(result.stopReason, 'satisficed');
  assert.equal(result.meetsQualityBar, true);
  assert.equal(result.answer, 'draft v2');
  assert.equal(result.trace.length, 2);
});

test('runSatisficingLoop: stops on plateau (diminishing returns)', async () => {
  const result = await runSatisficingLoop({
    generator: mockGenerator(),
    judge: scriptedJudge([
      { overall: 70 }, // iter1 continue
      { overall: 71 }, // iter2 delta 1 < minDelta 3 -> diminishing-returns
    ]),
  });
  assert.equal(result.iterations, 2);
  assert.equal(result.stopReason, 'diminishing-returns');
  assert.equal(result.meetsQualityBar, false);
});

test('runSatisficingLoop: runs to max-iterations when never good enough', async () => {
  const result = await runSatisficingLoop({
    generator: mockGenerator(),
    // steady, healthy improvement that still never reaches target 80
    judge: scriptedJudge([
      { overall: 50 },
      { overall: 56 },
      { overall: 62 },
      { overall: 68 },
    ]),
  });
  assert.equal(result.iterations, DEFAULT_SATISFICING_CRITERIA.maxIterations);
  assert.equal(result.stopReason, 'max-iterations');
  assert.equal(result.meetsQualityBar, false);
  assert.equal(result.trace.length, DEFAULT_SATISFICING_CRITERIA.maxIterations);
});

test('runSatisficingLoop: satisficing on the FIRST draft skips revision entirely', async () => {
  const result = await runSatisficingLoop({
    generator: mockGenerator(),
    judge: scriptedJudge([{ overall: 91, scores: { honesty: 5, grounding: 5 } }]),
  });
  assert.equal(result.iterations, 1);
  assert.equal(result.stopReason, 'satisficed');
  assert.equal(result.meetsQualityBar, true);
});
