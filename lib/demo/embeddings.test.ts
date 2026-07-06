/**
 * Unit tests for the deterministic demo embedding space (SYNTHETIC — not
 * model embeddings; see embeddings.ts for what that means and does not mean).
 * Pure: no DB, no key, no network.
 * Run: npx tsx --test lib/demo/embeddings.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fnv1a32,
  tokenize,
  tokenVector,
  buildIdfTable,
  smoothedIdf,
  embedDemoText,
  DEMO_EMBEDDING_DIM,
} from './embeddings';
import { cosineSimilarity, norm } from '@/lib/quality-gates/vector-math';

test('tokenize: lowercases, keeps alphanumeric runs, drops stopwords and 1-char tokens', () => {
  assert.deepEqual(
    tokenize('I designed the Taxonomy schemas for a 12,000-record archive!'),
    ['designed', 'taxonomy', 'schemas', '12', '000', 'record', 'archive'],
  );
  assert.deepEqual(tokenize('Should I do it?'), []); // all stopwords / 1-char
  assert.deepEqual(tokenize(''), []);
});

test('fnv1a32 is the standard FNV-1a 32-bit hash (stable across runs)', () => {
  // Offset basis for the empty string is the FNV-1a spec constant.
  assert.equal(fnv1a32(''), 0x811c9dc5);
  // Deterministic and distinct for distinct tokens.
  assert.equal(fnv1a32('python'), fnv1a32('python'));
  assert.notEqual(fnv1a32('python'), fnv1a32('sql'));
});

test('tokenVector: deterministic, right dimension, components in [-1, 1)', () => {
  const a = tokenVector('metadata');
  const b = tokenVector('metadata');
  assert.equal(a.length, DEMO_EMBEDDING_DIM);
  assert.deepEqual(Array.from(a), Array.from(b));
  for (const x of a) assert.ok(x >= -1 && x < 1);
  // Different tokens get different directions.
  assert.notDeepEqual(Array.from(a), Array.from(tokenVector('taxonomy')));
});

test('buildIdfTable: rarer tokens weigh more; matches the smoothed-idf formula', () => {
  const docs = [
    ['python', 'sql', 'data'],
    ['python', 'library'],
    ['python', 'data'],
  ];
  const table = buildIdfTable(docs);
  assert.equal(table.nDocs, 3);
  assert.equal(table.idf['python'], smoothedIdf(3, 3));
  assert.equal(table.idf['data'], smoothedIdf(2, 3));
  assert.equal(table.idf['library'], smoothedIdf(1, 3));
  assert.ok(table.idf['library'] > table.idf['data']);
  assert.ok(table.idf['data'] > table.idf['python']);
  // Closed vocabulary: unseen tokens simply are not in the table.
  assert.equal(table.idf['pokemon'], undefined);
});

const TABLE = buildIdfTable([
  ['python', 'sql', 'pandas', 'library'],
  ['library', 'metadata', 'taxonomy'],
  ['python', 'dashboard', 'metadata'],
]);

test('embedDemoText: unit norm for in-vocabulary text, deterministic, bag-of-words', () => {
  const v1 = embedDemoText('python and sql for metadata', TABLE);
  const v2 = embedDemoText('python and sql for metadata', TABLE);
  assert.deepEqual(v1, v2);
  assert.ok(Math.abs(norm(v1) - 1) < 1e-9);
  // Word order does not matter (bag of words).
  const v3 = embedDemoText('metadata for sql and python', TABLE);
  assert.deepEqual(v1, v3);
});

test('embedDemoText: text sharing no vocabulary embeds to the zero vector', () => {
  const v = embedDemoText('which pokemon wins a gym battle', TABLE);
  assert.equal(v.length, DEMO_EMBEDDING_DIM);
  assert.ok(v.every((x) => x === 0));
  // vector-math treats the zero vector as "no support", not NaN.
  const chunk = embedDemoText('python sql pandas', TABLE);
  assert.equal(cosineSimilarity(v, chunk), 0);
});

test('cosine structure: shared distinctive vocabulary ⇒ high similarity, disjoint ⇒ near zero', () => {
  const chunk = embedDemoText('library metadata taxonomy', TABLE);
  const related = embedDemoText('my metadata and taxonomy work', TABLE);
  const unrelated = embedDemoText('python sql', TABLE); // in-vocab but disjoint tokens
  const simRelated = cosineSimilarity(related, chunk);
  const simUnrelated = cosineSimilarity(unrelated, chunk);
  assert.ok(
    simRelated > 0.5,
    `expected strong overlap similarity, got ${simRelated}`,
  );
  // Distinct tokens are near-orthogonal (hash noise ~1/sqrt(dim)).
  assert.ok(
    Math.abs(simUnrelated) < 0.2,
    `expected near-orthogonal, got ${simUnrelated}`,
  );
  assert.ok(simRelated > simUnrelated);
});
