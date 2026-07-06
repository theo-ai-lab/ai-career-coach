"use client";

/**
 * Shared chat-message renderer for the live coach (app/page.tsx) and the
 * keyless demo (app/demo/page.tsx). Extracted verbatim from app/page.tsx so
 * both surfaces render answers — and every gate banner (OOD abstention, HITL
 * review, re-retrieval note, grounding check) — through the same component.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  FileQuestion,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

export interface Scores {
  overall: number;
  actionability: number;
  personalization: number;
  honesty: number;
  grounding: number;
}

export interface QuerySignals {
  confidence: number;
  region: "dense" | "borderline" | "sparse";
  meanSimilarity: number;
  hitl: {
    routeToHuman: boolean;
    triggers: string[];
    reason: string;
  };
  reretrieval: {
    attempted: boolean;
    fired: boolean;
    infoGain: number | null;
    savedCall: boolean;
    improved: boolean;
  };
  satisficing: {
    iterations: number;
    stopReason: string;
    meetsQualityBar: boolean;
  } | null;
  /**
   * Post-generation grounding gate: the answer's factual claims reconciled
   * against the retrieved résumé evidence via Pacioli. Optional/nullable so a
   * response from a build without the gate (or before it ran) still renders.
   */
  grounding?: {
    status: "flagged" | "clean" | "deterministic-only" | "skipped" | "unavailable";
    checked: number;
    unsupported: number;
    overclaim: number;
    judgeMode: string | null;
    flagged: Array<{
      claim: string;
      status: "unsupported" | "overclaim";
      note: string | null;
    }>;
    reason: string | null;
  } | null;
  /**
   * Pre-generation OOD screen. When `abstained`, the coach short-circuited an
   * off-résumé query with an honest non-answer BEFORE the model could
   * confabulate. The threshold is conformal-calibrated (see ood-gate.ts).
   */
  ood?: {
    abstained: boolean;
    score: number;
    threshold: number | null;
    targetAbstainRate: number;
    coverage: number;
    centroidProximity: number;
    margin: number;
  } | null;
  /** Per-gate cascade telemetry + the repo's measured cheap→expensive slice. */
  cascade?: {
    gates: Array<{
      gate: string;
      regime: string;
      locus: string;
      skippedExpensiveStep: boolean | null;
    }>;
    measured: {
      boundary: string;
      alpha: number;
      expensiveShare: number;
      disagreementRate: number;
      losslessViolations: number;
      n: number;
    };
    /**
     * Live per-gate acceptance tally for the serving instance — a running
     * skip-vs-escalate count since this process cold start. This is the LIVE
     * in-instance signal (resets on cold start, not shared across serverless
     * instances), distinct from the calibrated offline `measured` slice.
     * Optional: only present when the route attaches a counter snapshot.
     */
    live?: Record<
      string,
      { runs: number; skips: number; rate: number | null }
    >;
  } | null;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  scores?: Scores | null;
  signals?: QuerySignals | null;
  /** True for a clear error / not-configured notice (not a real answer). */
  notice?: boolean;
  /**
   * Demo-mode provenance caption (keyless /demo only): how this answer was
   * produced — canned / extractive / gate abstention, from the server's
   * demo.generationNote (lib/demo/run-demo-query.ts). Rendered verbatim under
   * the bubble so honesty is visible in any recording.
   */
  demoNote?: string;
}

export const TRIGGER_LABELS: Record<string, string> = {
  "sparse-data-density": "limited supporting evidence in your resume",
  "high-stakes-keyword": "a high-stakes career decision",
  "below-quality-bar": "the answer did not clear the quality bar",
  "grounding-unsupported": "statements not supported by your resume",
};

export function reretrievalNote(
  r: QuerySignals["reretrieval"],
): { text: string; tone: "info" | "muted" } | null {
  if (!r.attempted) return null;
  if (r.fired && r.improved) {
    return { text: "Refined the search and found stronger evidence.", tone: "info" };
  }
  if (r.fired) {
    return { text: "Tried a refined search; kept the original evidence.", tone: "muted" };
  }
  return { text: "Skipped a redundant re-search (no new information).", tone: "muted" };
}

export function ChatMessage({ message: m }: { message: Message }) {
  const reNote =
    m.role === "assistant" && m.signals
      ? reretrievalNote(m.signals.reretrieval)
      : null;
  const routeToHuman = m.signals?.hitl.routeToHuman ?? false;
  const reviewTriggers = (m.signals?.hitl.triggers ?? [])
    .map((t) => TRIGGER_LABELS[t] ?? t)
    .filter(Boolean);
  const grounding =
    m.role === "assistant" ? (m.signals?.grounding ?? null) : null;
  const ood = m.role === "assistant" ? (m.signals?.ood ?? null) : null;

  return (
    <div className={`mb-4 ${m.role === "user" ? "text-right" : "text-left"}`}>
      <div
        className={`inline-block p-3 rounded-lg text-left ${
          m.role === "user"
            ? "max-w-[85%] bg-blue-600 text-white"
            : m.notice
              ? "max-w-[90%] bg-amber-50 text-amber-900 border border-amber-200"
              : "max-w-[90%] bg-slate-200 text-slate-800"
        }`}
      >
        {m.role === "assistant" ? (
          <div className="prose prose-sm prose-slate max-w-none break-words prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {m.content}
            </ReactMarkdown>
          </div>
        ) : (
          <span className="whitespace-pre-wrap break-words">{m.content}</span>
        )}
      </div>

      {/* Demo-mode provenance caption: demo answers announce how they were
          produced outside the bubble too, so honesty is visible in any
          recording. */}
      {m.role === "assistant" && m.demoNote && (
        <div className="mt-1 text-[11px] text-slate-400">{m.demoNote}</div>
      )}

      {/* Pre-generation OOD screen: the query was clearly off-résumé,
          so the coach gave an honest non-answer BEFORE the model could
          confabulate. Threshold is conformal-calibrated (ood-gate.ts). */}
      {ood?.abstained && (
        <div
          role="status"
          className="mt-2 max-w-[90%] text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-md px-3 py-2 flex items-start gap-2"
          title={`OOD score ${ood.score.toFixed(3)} > calibrated threshold ${ood.threshold !== null ? ood.threshold.toFixed(3) : "n/a"} (target abstain budget ${(ood.targetAbstainRate * 100).toFixed(0)}%)`}
        >
          <FileQuestion className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>
            <span className="font-medium">
              Off-résumé question — answered without the model.
            </span>
            <span className="block text-sky-800">
              This sits outside what your résumé covers (retrieval surprise{" "}
              {ood.score.toFixed(2)} over the calibrated{" "}
              {ood.threshold !== null ? ood.threshold.toFixed(2) : "n/a"}{" "}
              cutoff), so the coach didn&apos;t generate an answer rather than
              risk inventing one.
            </span>
          </span>
        </div>
      )}

      {/* Confidence / HITL review banner — driven by the live
          quality-gate signals (sparse data density, high-stakes
          keyword, or an answer that did not clear the quality bar). */}
      {m.role === "assistant" && routeToHuman && (
        <div
          role="status"
          className="mt-2 max-w-[90%] text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-2"
          title={m.signals?.hitl.reason}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>
            <span className="font-medium">
              Low confidence — consider human review.
            </span>
            {reviewTriggers.length > 0 && (
              <span className="block text-amber-700">
                Flagged because: {reviewTriggers.join("; ")}.
              </span>
            )}
          </span>
        </div>
      )}

      {/* Backward-compatible low-confidence note for responses with
          no signals payload (e.g. a fallback generation). */}
      {m.role === "assistant" &&
        !m.signals &&
        m.scores &&
        m.scores.overall < 75 && (
          <div className="mt-2 text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              I&apos;m less confident about this response. Consider verifying
              this information.
            </span>
          </div>
        )}

      {/* Subtle re-retrieval indicator. */}
      {m.role === "assistant" && reNote && (
        <div
          className={`mt-1.5 text-[11px] flex items-center gap-1 ${
            reNote.tone === "info" ? "text-slate-500" : "text-slate-400"
          }`}
        >
          <RefreshCw className="h-3 w-3 shrink-0" aria-hidden />
          <span>{reNote.text}</span>
        </div>
      )}

      {/* Post-generation grounding gate — the answer's factual claims
          reconciled against the retrieved résumé evidence via Pacioli.
          'flagged' = >=1 claim not supported; 'clean'/'deterministic-
          only' shown subtly; 'skipped'/'unavailable' render nothing. */}
      {grounding && grounding.status === "flagged" && (
        <div
          role="status"
          className="mt-2 max-w-[90%] text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span className="font-medium">
              Grounding check: {grounding.unsupported + grounding.overclaim}{" "}
              statement
              {grounding.unsupported + grounding.overclaim === 1 ? "" : "s"} not
              fully supported by your résumé.
            </span>
          </div>
          {grounding.flagged.length > 0 && (
            <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-rose-700">
              {grounding.flagged.slice(0, 5).map((f, j) => (
                <li key={j}>
                  <span className="italic">&ldquo;{f.claim}&rdquo;</span>
                  {f.note ? <span> — {f.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {grounding &&
        (grounding.status === "clean" ||
          grounding.status === "deterministic-only") && (
          <div className="mt-1.5 text-[11px] flex items-center gap-1 text-slate-500">
            <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
            <span>
              {grounding.status === "clean"
                ? `Grounding check: ${grounding.checked} claim${grounding.checked === 1 ? "" : "s"} reconciled against your résumé.`
                : `Grounding check: ${grounding.checked} claim${grounding.checked === 1 ? "" : "s"} checked (structural only — semantic verification not enabled).`}
            </span>
          </div>
        )}
    </div>
  );
}
