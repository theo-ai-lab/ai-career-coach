/**
 * grounding/claim-extraction.ts
 *
 * Pure, deterministic, key-free extraction of the FACTUAL CLAIMS A COACHING
 * ANSWER MAKES ABOUT THE USER, plus packing of the retrieved résumé chunks into
 * Pacioli's evidence shape. No LLM, no network — so it is fully unit-testable
 * offline and adds zero latency/cost to the hot path before the (optional)
 * network reconcile.
 *
 * WHY A HEURISTIC (and its honest limits)
 * ---------------------------------------
 * A claim like "you have 5 years of Python" or "your résumé shows leadership"
 * is a second-person ASSERTION OF FACT about the candidate. Advice ("you should
 * highlight..."), hypotheticals ("if you were to..."), and questions are NOT
 * factual claims and must not be reconciled. We separate the two with a
 * second-person assertion pattern minus an advice/modal/conditional pattern.
 *
 * This is a precision-leaning HEURISTIC, not a parser: it will miss claims
 * phrased in the third person ("the candidate has...") and may over-extract an
 * occasional hedged sentence. That is acceptable — the gate is a complementary
 * safety net, and a missed extraction simply means that claim is not double-
 * checked (it never fabricates a verdict). The patterns are module constants,
 * documented so they can be tuned against real traces.
 */

import type { ExtractedClaim, PacioliEvidence } from './types';

/**
 * Second-person assertions of fact about the user. Matching ONE of these makes
 * a sentence a candidate claim (before the advice filter below removes it).
 */
const ASSERTION_PATTERNS: readonly RegExp[] = [
  // "you have / you've / you had ..." and state-of-being assertions.
  /\byou(?:'ve|'re)\b/i,
  /\byou\s+(?:have|had|are|were|bring|possess|hold|held|earned|gained|built|led|managed|developed|demonstrated|worked|served|completed|achieved|spent|show|showed|display|displayed)\b/i,
  // "your résumé/background/experience <asserts> ..." — the noun must be the
  // SUBJECT of an assertion verb, so "Your résumé shows leadership" matches but
  // "...enough information in your résumé to answer" (a hedge) does not.
  /\byour\s+(?:resume|résumé|cv|background|experience|expertise|profile|history|work\s+history|track\s+record|skill\s*set|skills|education|qualifications|credentials)\s+(?:shows?|showed|demonstrates?|demonstrated|highlights?|highlighted|includes?|included|lists?|listed|reflects?|reflected|indicates?|indicated|reveals?|revealed|contains?|contained|features?|featured|details?|detailed|suggests?|suggested|positions?|makes?|gives?|speaks?|points?|is|are|was|were|has|had)\b/i,
  // "your N (years|months) of ..." e.g. "your 5 years of Python"
  /\byour\s+\d+\+?\s+(?:years?|months?)\b/i,
];

/**
 * Advice / modality / conditionals / questions. Matching ANY of these removes a
 * sentence from the claim set even if it tripped an assertion pattern — these
 * are recommendations or hypotheticals, not factual claims about the user.
 */
const ADVICE_PATTERNS: readonly RegExp[] = [
  /\byou(?:'d|'ll)\b/i,
  /\byou\s+(?:should|shall|could|can|may|might|must|will|would|need\s+to|ought|want\s+to|may\s+want|have\s+to|get\s+to|tend\s+to)\b/i,
  /\b(?:if|when|once|whenever|suppose|imagine)\s+you\b/i,
  // Leading imperative coaching verbs ("Consider ...", "Highlight ...").
  /^(?:consider|try|focus|highlight|emphasi[sz]e|make\s+sure|remember|ensure|aim|start|begin|think\s+about|reach\s+out|tailor|frame|position|lean\s+into|double\s+down)\b/i,
];

/** Strip markdown decoration so a claim's text is clean prose for Pacioli. */
function stripMarkdown(line: string): string {
  return line
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // inline code fences
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/__([^_]+)__/g, '$1') // bold (underscore)
    .replace(/_([^_]+)_/g, '$1') // italic (underscore)
    .replace(/^\s*#{1,6}\s+/, '') // headings
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '') // list markers
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .trim();
}

/**
 * Split an answer into candidate sentences. We break on newlines (each list
 * item / paragraph) and on sentence terminators, keeping the segmentation
 * conservative so a multi-clause claim survives intact.
 */
function splitSentences(answer: string): string[] {
  const out: string[] = [];
  for (const rawLine of answer.split(/\r?\n/)) {
    const line = stripMarkdown(rawLine);
    if (!line) continue;
    // Split on a terminator followed by whitespace + a capital/quote/digit, so
    // "5 years." then "You also..." separate but "U.S." style abbreviations and
    // decimals are far less likely to over-split.
    for (const piece of line.split(/(?<=[.!?])\s+(?=["“'(\d]|[A-Z])/)) {
      const s = piece.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const MIN_CLAIM_CHARS = 12;
const MAX_CLAIM_CHARS = 600;

/** True iff a sentence asserts a fact about the user (and is not advice). */
export function isFactualClaim(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < MIN_CLAIM_CHARS || s.length > MAX_CLAIM_CHARS) return false;
  if (s.endsWith('?')) return false; // questions are not claims
  if (ADVICE_PATTERNS.some((re) => re.test(s))) return false;
  return ASSERTION_PATTERNS.some((re) => re.test(s));
}

export interface ExtractOptions {
  /** Hard cap on claims sent to Pacioli (its batch ceiling is 100). Default 25. */
  maxClaims?: number;
}

/**
 * Extract the factual claims a coaching answer makes about the user. Returns
 * de-duplicated claims with stable ids. Deterministic and side-effect free.
 */
export function extractFactualClaims(
  answer: string,
  opts: ExtractOptions = {},
): ExtractedClaim[] {
  const maxClaims = Math.max(1, Math.min(opts.maxClaims ?? 25, 100));
  if (typeof answer !== 'string' || answer.trim().length === 0) return [];

  const seen = new Set<string>();
  const claims: ExtractedClaim[] = [];
  for (const sentence of splitSentences(answer)) {
    if (!isFactualClaim(sentence)) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ id: `claim-${claims.length}`, text: sentence.slice(0, 4000) });
    if (claims.length >= maxClaims) break;
  }
  return claims;
}

// ── Evidence packing ─────────────────────────────────────────────────────────

const EVIDENCE_MAX_ITEMS = 50; // Pacioli EvidenceSchema: items <= 50 entries
const EVIDENCE_ITEM_CHARS = 200; // Pacioli EvidenceSchema: each item <= 200 chars
const EVIDENCE_EXCERPT_CHARS = 1000; // Pacioli EvidenceSchema: excerpt <= 1000 chars

/**
 * Pack the joined evidence text into <=200-char, word-bounded segments (so we
 * carry as much of the retrieved résumé as Pacioli's per-item bound allows
 * without truncating mid-word), capped at EVIDENCE_MAX_ITEMS.
 */
function chunkIntoItems(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const items: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > EVIDENCE_ITEM_CHARS) {
      if (current) items.push(current);
      // A single oversized token is hard-truncated to the item bound.
      current = word.length > EVIDENCE_ITEM_CHARS ? word.slice(0, EVIDENCE_ITEM_CHARS) : word;
    } else {
      current = candidate;
    }
    if (items.length >= EVIDENCE_MAX_ITEMS) break;
  }
  if (current && items.length < EVIDENCE_MAX_ITEMS) items.push(current);
  return items.slice(0, EVIDENCE_MAX_ITEMS);
}

/**
 * Build Pacioli's shared evidence packet from the retrieved résumé chunks,
 * respecting Pacioli's schema bounds. NOTE (honest limit): Pacioli's judge
 * fences the evidence it actually reads, so for very long résumés this carries
 * a BOUNDED view of the evidence — sufficient for a focused per-claim check,
 * but not the entire corpus. Per-claim targeted evidence is future work.
 */
export function buildEvidence(
  contexts: readonly string[],
  evidenceLabel: string,
): PacioliEvidence {
  const joined = contexts.join('\n').replace(/\s+/g, ' ').trim();
  return {
    merchant: (evidenceLabel || 'resume').slice(0, 200),
    excerpt: joined.slice(0, EVIDENCE_EXCERPT_CHARS),
    items: chunkIntoItems(joined),
    recurring: false,
  };
}
