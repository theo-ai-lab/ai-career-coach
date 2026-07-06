/**
 * demo/scripted-queries.ts
 *
 * The three scripted demo queries and their CANNED completions.
 *
 * Each query exercises one gate outcome FOR REAL — the OOD decision, the
 * density assessment, and the HITL routing all run through the actual
 * quality-gate code over the demo embedding space; nothing about the gate
 * decisions is scripted. Only the ANSWER TEXT is canned (there is no model in
 * demo mode), authored strictly from the committed fictional persona
 * (data/eval-benchmark/personas/synthetic-redteam-resume.md) with no invented
 * facts. lib/demo/run-demo-query.test.ts locks each query to its intended
 * gate outcome so a corpus or calibration change cannot silently break the
 * script.
 *
 * The off-résumé query has NO canned answer on purpose: when the OOD gate
 * abstains, the response is the gate's own OOD_ABSTAIN_MESSAGE — the same
 * deterministic short-circuit production serves.
 *
 * CLIENT-SAFE: pure text constants, no artifact import — /demo (a client
 * component) imports this module without pulling the committed corpus JSON
 * into the browser bundle.
 */

export type DemoGenerationKind = 'canned' | 'extractive' | 'gate-abstention';

/** The always-visible honesty label for demo mode (rendered in the UI header
 * and carried on every demo response payload). */
export const DEMO_MODE_LABEL =
  'demo corpus · deterministic demo embeddings · canned generation';

/** Display name of the committed fictional persona the demo corpus is built
 * from (data/eval-benchmark/personas/synthetic-redteam-resume.md). */
export const DEMO_PERSONA_NAME = 'Avery Patel';

export interface ScriptedDemoQuery {
  id: string;
  /** Short UI chip label. */
  label: string;
  /** The exact query text sent to the demo pipeline. */
  query: string;
  /** What this query demonstrates (shown in the UI). */
  demonstrates: string;
  /**
   * The canned completion (authored, grounded in the fictional persona only).
   * null ⇒ the gate's own deterministic message is the answer (OOD abstention).
   */
  cannedAnswer: string | null;
}

export const SCRIPTED_DEMO_QUERIES: ScriptedDemoQuery[] = [
  {
    id: 'demo-grounded',
    label: 'Grounded question',
    query: 'What experience do I have with Python, SQL, and data analysis?',
    demonstrates:
      'A question the demo résumé actually supports: retrieval finds dense evidence, every gate passes, and the answer stays grounded.',
    cannedAnswer:
      'Based on your résumé, your Python and SQL are self-taught and listed at an ' +
      'intermediate level, alongside pandas, matplotlib, and Streamlit. The concrete ' +
      'evidence is your **covid-county-explorer** project — a Streamlit dashboard ' +
      'exploring COVID-19 case rates by California county, pulling from the CDC ' +
      'public dataset and using pandas, matplotlib, and scikit-learn for trend ' +
      'fitting — plus the Google Data Analytics Professional Certificate (Coursera, ' +
      '2025). To be candid about the gap: nothing on the résumé shows Python or SQL ' +
      'used in a production or team setting, so on paper this reads as ' +
      'personal-project depth rather than professional data-science experience.',
  },
  {
    id: 'demo-hitl',
    label: 'High-stakes question',
    query:
      'What salary should I ask for in a junior data scientist role, and how should I handle the salary negotiation?',
    demonstrates:
      'A high-stakes topic: the keyword gate flags salary negotiation and routes the answer to human review — the gates run for real.',
    cannedAnswer:
      "Your résumé doesn't include salary history or an offer in hand, so I can't " +
      "anchor a number for you — and I won't invent one. What it does support: " +
      "you're targeting junior-to-mid-level data scientist roles while " +
      'transitioning from five years in library and research services, with the ' +
      'technical evidence being a self-taught skill set, one Streamlit project, and ' +
      'a 2025 Coursera certificate. That profile usually lands at the junior end of ' +
      'a band, and your strongest levers are the transferable domain skills ' +
      '(metadata, taxonomy design, research consultation) rather than years of ' +
      'data-science experience. For the negotiation itself — an actual number, ' +
      'equity, or a counteroffer — treat this as a decision to sanity-check with a ' +
      "human (a mentor or a recruiter you trust): it's high-stakes and outside what " +
      'your résumé alone can settle.',
  },
  {
    id: 'demo-ood',
    label: 'Off-résumé question',
    query: 'Which Pokemon should I use to win a Gym Leader battle?',
    demonstrates:
      'A question with no résumé support at all: the conformal OOD gate abstains BEFORE generation instead of letting an answer be invented.',
    cannedAnswer: null,
  },
];

/** Normalize for scripted-query matching: trim, lowercase, collapse spaces. */
function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Find the scripted entry a free-typed query matches, if any. */
export function matchScriptedQuery(query: string): ScriptedDemoQuery | null {
  const normalized = normalizeQuery(query);
  return (
    SCRIPTED_DEMO_QUERIES.find(
      (s) => normalizeQuery(s.query) === normalized,
    ) ?? null
  );
}
