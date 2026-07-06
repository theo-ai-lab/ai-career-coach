/**
 * demo/embeddings.ts
 *
 * DETERMINISTIC DEMO EMBEDDING SPACE — SYNTHETIC, NOT MODEL EMBEDDINGS.
 *
 * WHY THIS EXISTS
 * ---------------
 * The quality gates (lib/quality-gates/) are pure TypeScript over cosine
 * similarities — they don't care where the vectors came from. Demo mode
 * (/demo) lets a visitor exercise the gates with NO API key, which means no
 * OpenAI `text-embedding-3-small`. Instead of shipping canned similarity
 * numbers (which would make the gates decorative), demo mode embeds text into
 * a deterministic hashed bag-of-words space and lets the REAL gate code make
 * REAL decisions over the resulting geometry.
 *
 * WHAT IT IS (and is not)
 * -----------------------
 * A seeded hashing-trick embedder with tf-idf weighting over a CLOSED
 * vocabulary (the demo corpus's own tokens — the same convention as a lexical
 * TF-IDF retrieval index, where out-of-vocabulary terms match nothing):
 *   1. tokenize: lowercase, alphanumeric runs, drop 1-char tokens + stopwords;
 *   2. each corpus-vocabulary token maps to a fixed pseudo-random direction
 *      (fnv1a(token) seeds the same mulberry32 PRNG the calibration split
 *      uses — see lib/quality-gates/ood-score.ts); tokens outside the corpus
 *      vocabulary contribute nothing;
 *   3. a text's vector is the idf-weighted sum of its token vectors (term
 *      frequency × inverse document frequency over the demo corpus chunks),
 *      L2-normalized. A text sharing NO vocabulary with the corpus embeds to
 *      the zero vector — cosine 0 to everything, i.e. maximal retrieval
 *      surprise.
 *
 * Texts that share distinctive vocabulary with the demo resume get high cosine
 * similarity to its chunks; texts that share none sit at zero (distinct
 * corpus tokens are near-orthogonal up to hash noise ~1/sqrt(dim)). That gives
 * the space MEANINGFUL cosine structure — in-corpus chunks cluster, off-corpus
 * queries are distant — which is exactly the property the OOD/density gates
 * key on.
 *
 * It is NOT a semantic model: no paraphrase understanding (no stemming
 * either — "role" and "roles" are different tokens), no real-world detection
 * power, and its numbers say nothing about the production embedding space.
 * Every artifact derived from it is labeled accordingly, and the demo UI
 * states "deterministic demo embeddings" on screen.
 *
 * Pure + keyless: no DB, no network, no LLM, no `server-only`.
 */

import { mulberry32 } from '@/lib/quality-gates/ood-score';

/** Dimensionality of the demo space. Hash noise scales ~1/sqrt(dim). */
export const DEMO_EMBEDDING_DIM = 1024;

/**
 * Version tag baked into the committed artifacts so a change to the embedder
 * (tokenizer, stopwords, dim, PRNG) is an explicit, visible schema break.
 */
export const DEMO_EMBEDDING_SPACE = 'demo-hash-tfidf-v1';

/**
 * Compact English stopword list. Function words carry no grounding signal and
 * would otherwise let "should I ... my ..." overlap every chunk. Fixed here —
 * part of the versioned embedding-space definition, not tunable at runtime.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'in',
  'on', 'at', 'to', 'for', 'from', 'by', 'with', 'about', 'as', 'into',
  'through', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'do',
  'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could',
  'should', 'shall', 'may', 'might', 'must', 'i', 'me', 'my', 'mine', 'you',
  'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its',
  'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs', 'this',
  'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'how', 'when',
  'where', 'why', 'not', 'no', 'so', 'up', 'out', 'just', 'than', 'too',
  'very', 'own', 'per',
]);

/** FNV-1a 32-bit hash — the deterministic token -> PRNG-seed mapping. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Tokenize into lowercase alphanumeric runs, dropping 1-char tokens and
 * stopwords. Deterministic; the whole space definition depends on it.
 */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return matches.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

const tokenVectorCache = new Map<string, Float64Array>();

/**
 * The fixed pseudo-random direction for one token: mulberry32(fnv1a(token))
 * drives `dim` uniform draws in [-1, 1). Deterministic across processes.
 */
export function tokenVector(
  token: string,
  dim: number = DEMO_EMBEDDING_DIM,
): Float64Array {
  const key = `${dim}:${token}`;
  const cached = tokenVectorCache.get(key);
  if (cached) return cached;
  const rand = mulberry32(fnv1a32(token));
  const v = new Float64Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rand() * 2 - 1;
  tokenVectorCache.set(key, v);
  return v;
}

/**
 * The demo space's closed vocabulary: inverse-document-frequency weights over
 * the demo corpus chunks. Computed once by scripts/build-demo-artifacts.ts and
 * committed inside lib/demo/demo-corpus.json — the table IS the vocabulary;
 * tokens missing from it contribute nothing to an embedding (the TF-IDF
 * retrieval-index convention for out-of-vocabulary terms).
 */
export interface DemoIdfTable {
  /** Number of corpus documents (chunks) the df counts were taken over. */
  nDocs: number;
  /** Smoothed idf per vocabulary token: ln((1 + nDocs) / (1 + df)) + 1. */
  idf: Record<string, number>;
}

/** Smoothed idf: ln((1 + nDocs) / (1 + df)) + 1 (scikit-learn convention). */
export function smoothedIdf(df: number, nDocs: number): number {
  return Math.log((1 + nDocs) / (1 + df)) + 1;
}

/** Build the idf table (the space's vocabulary) from tokenized corpus docs. */
export function buildIdfTable(docs: readonly string[][]): DemoIdfTable {
  const df = new Map<string, number>();
  for (const tokens of docs) {
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const idf: Record<string, number> = {};
  for (const [token, count] of [...df.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    idf[token] = smoothedIdf(count, docs.length);
  }
  return { nDocs: docs.length, idf };
}

/**
 * Embed a text into the demo space: idf-weighted sum of the vocabulary-token
 * vectors, L2-normalized. A text sharing no vocabulary with the corpus embeds
 * to the zero vector, which cosineSimilarity
 * (lib/quality-gates/vector-math.ts) treats as "no support" (similarity 0)
 * rather than NaN — the maximally-surprising case for the OOD gate.
 */
export function embedDemoText(
  text: string,
  idfTable: DemoIdfTable,
  dim: number = DEMO_EMBEDDING_DIM,
): number[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  // Accumulate in sorted-token order so the embedding is EXACTLY
  // order-independent (floating-point addition is not associative; without a
  // fixed order, "a b" and "b a" would differ in the last ulp and the
  // bag-of-words contract would only hold approximately).
  const sortedEntries = [...counts.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const acc = new Float64Array(dim);
  for (const [token, tf] of sortedEntries) {
    const idf = idfTable.idf[token];
    if (idf === undefined) continue; // out-of-vocabulary: contributes nothing
    const weight = tf * idf;
    const tv = tokenVector(token, dim);
    for (let i = 0; i < dim; i++) acc[i] += weight * tv[i];
  }

  let normSq = 0;
  for (let i = 0; i < dim; i++) normSq += acc[i] * acc[i];
  if (normSq === 0) return Array.from(acc);
  const inv = 1 / Math.sqrt(normSq);
  return Array.from(acc, (x) => x * inv);
}
