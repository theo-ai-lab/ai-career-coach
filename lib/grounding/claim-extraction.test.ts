/**
 * Unit tests for grounding/claim-extraction.
 * Pure functions — no LLM, no network, no key.
 * Run: npx tsx --test lib/grounding/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractFactualClaims,
  isFactualClaim,
  buildEvidence,
} from './claim-extraction';

test('extracts second-person factual assertions about the user', () => {
  const answer =
    'You have 5 years of Python experience. Your résumé shows leadership on two teams.';
  const claims = extractFactualClaims(answer);
  assert.equal(claims.length, 2);
  assert.match(claims[0].text, /5 years of Python/);
  assert.match(claims[1].text, /leadership on two teams/);
  assert.deepEqual(
    claims.map((c) => c.id),
    ['claim-0', 'claim-1'],
  );
});

test('excludes advice, hypotheticals, and questions (not factual claims)', () => {
  assert.equal(isFactualClaim('You should highlight your leadership experience.'), false);
  assert.equal(isFactualClaim('You could pivot into product management.'), false);
  assert.equal(isFactualClaim('If you were to apply, you would be competitive.'), false);
  assert.equal(isFactualClaim('Consider tailoring your résumé to each role.'), false);
  assert.equal(isFactualClaim('What roles are you targeting?'), false);
  // ...but a genuine assertion still passes.
  assert.equal(isFactualClaim('You have a Master of Library Science degree.'), true);
});

test('captures the mr-02-style false confirmation as a checkable claim', () => {
  // The red-team mr-02 failure: the Coach actively endorses a false equivalence.
  const answer =
    "You're correct in drawing parallels between cataloging books and feature engineering for machine learning. Use this framing in your cover letter.";
  const claims = extractFactualClaims(answer);
  // The endorsement sentence is extracted; the imperative "Use this..." is not.
  assert.equal(claims.length, 1);
  assert.match(claims[0].text, /cataloging books and feature engineering/i);
});

test('strips markdown decoration and list markers', () => {
  const answer = [
    '## Summary',
    '- **You have** extensive experience in *data engineering*.',
    '1. You led a migration to `PostgreSQL`.',
  ].join('\n');
  const claims = extractFactualClaims(answer);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].text, 'You have extensive experience in data engineering.');
  assert.equal(claims[1].text, 'You led a migration to PostgreSQL.');
});

test('de-duplicates identical claims and assigns stable ids', () => {
  const answer = 'You have leadership experience.\nYou have leadership experience.';
  const claims = extractFactualClaims(answer);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, 'claim-0');
});

test('honors the maxClaims cap', () => {
  const answer = Array.from(
    { length: 10 },
    (_, i) => `You have skill number ${i} on your résumé.`,
  ).join(' ');
  const claims = extractFactualClaims(answer, { maxClaims: 3 });
  assert.equal(claims.length, 3);
});

test('returns no claims for refusals / pure hedging / empty input', () => {
  assert.deepEqual(extractFactualClaims(''), []);
  assert.deepEqual(
    extractFactualClaims("I don't have enough information in your résumé to answer that."),
    [],
  );
  assert.deepEqual(extractFactualClaims('Could you upload your résumé first?'), []);
});

test('buildEvidence respects Pacioli schema bounds (items<=50x200, excerpt<=1000)', () => {
  const big = 'word '.repeat(5000); // ~25k chars
  const evidence = buildEvidence([big], 'resume');
  assert.equal(evidence.merchant, 'resume');
  assert.equal(evidence.recurring, false);
  assert.ok(evidence.excerpt.length <= 1000, 'excerpt within 1000');
  assert.ok(evidence.items.length <= 50, 'at most 50 items');
  for (const item of evidence.items) {
    assert.ok(item.length <= 200, `item within 200 chars (got ${item.length})`);
  }
});

test('buildEvidence joins multiple chunks and labels the source', () => {
  const evidence = buildEvidence(
    ['Led a team of 4 engineers.', 'B.S. in Computer Science, 2018.'],
    'resume',
  );
  assert.match(evidence.excerpt, /Led a team of 4 engineers/);
  assert.match(evidence.excerpt, /B\.S\. in Computer Science/);
  assert.equal(evidence.merchant, 'resume');
});
