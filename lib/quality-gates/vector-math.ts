/**
 * quality-gates/vector-math.ts
 *
 * Pure, dependency-free vector helpers shared by the data-density and
 * info-gain quality gates. No DB, no network, no LLM, no `server-only` —
 * every function here is deterministic and unit-testable with plain
 * `number[]` "mock vectors".
 *
 * These mirror the cosine-similarity semantics that Supabase pgvector
 * (`match_documents_v2`, HNSW cosine) uses at query time, so the gates can
 * reason about the SAME geometry the live retrieval path returns — without
 * needing a key or a DB connection to exercise the logic.
 */

/** Dot product of two equal-length vectors. */
export function dot(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `dot(): dimension mismatch (${a.length} vs ${b.length})`,
    );
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** Euclidean (L2) norm of a vector. */
export function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for a zero-magnitude vector
 * (undefined direction) rather than NaN, so a degenerate/empty embedding
 * is treated as "no support" instead of crashing the gate.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  const denom = norm(a) * norm(b);
  if (denom === 0) return 0;
  return dot(a, b) / denom;
}

/** Cosine distance == 1 - cosine similarity, in [0, 2]. */
export function cosineDistance(
  a: readonly number[],
  b: readonly number[],
): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * Cosine similarity of `query` against every vector in `corpus`, sorted
 * descending (most similar first). Empty corpus -> empty array.
 */
export function similaritiesTo(
  query: readonly number[],
  corpus: readonly (readonly number[])[],
): number[] {
  return corpus
    .map((v) => cosineSimilarity(query, v))
    .sort((x, y) => y - x);
}

/**
 * Top-k cosine similarities of `query` against `corpus` (the kNN
 * *similarities*, descending). If k exceeds the corpus size, all
 * similarities are returned. k must be a positive integer.
 */
export function kNearestSimilarities(
  query: readonly number[],
  corpus: readonly (readonly number[])[],
  k: number,
): number[] {
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error(`kNearestSimilarities(): k must be a positive integer, got ${k}`);
  }
  return similaritiesTo(query, corpus).slice(0, k);
}

/** Arithmetic mean of a non-empty list. Empty list -> 0. */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/** Clamp `x` into the inclusive range [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
