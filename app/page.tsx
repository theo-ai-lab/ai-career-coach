"use client";

import { useEffect, useRef, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, FileText, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { ScrollArea } from "@/components/ui/scroll-area";

import { Card } from "@/components/ui/card";

interface Scores {
  overall: number;
  actionability: number;
  personalization: number;
  honesty: number;
  grounding: number;
}

interface QuerySignals {
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
}

interface Message {
  role: "user" | "assistant";
  content: string;
  scores?: Scores | null;
  signals?: QuerySignals | null;
  /** True for a clear error / not-configured notice (not a real answer). */
  notice?: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  "sparse-data-density": "limited supporting evidence in your resume",
  "high-stakes-keyword": "a high-stakes career decision",
  "below-quality-bar": "the answer did not clear the quality bar",
};

function reretrievalNote(
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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState("");

  const [loading, setLoading] = useState(false);

  const [currentResumeId, setCurrentResumeId] = useState<string | null>(
    typeof window !== "undefined"
      ? localStorage.getItem("currentResumeId")
      : null,
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const [sessionId, setSessionId] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("sessionId") : null,
  );

  const [resumeFileName, setResumeFileName] = useState<string | null>(null);

  // Full-report (LangGraph orchestrator) state.
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input;

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    setInput("");

    setLoading(true);

    const resumeId =
      typeof window !== "undefined"
        ? localStorage.getItem("currentResumeId")
        : null;

    // Get or create sessionId
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = crypto.randomUUID();
      setSessionId(currentSessionId);
      if (typeof window !== "undefined") {
        localStorage.setItem("sessionId", currentSessionId);
      }
    }

    try {
      // Send messages array for session summarization
      const res = await fetch("/api/query", {
        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          query: userMessage,
          resumeId,
          sessionId: currentSessionId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      let data: {
        answer?: string;
        message?: string;
        scores?: Scores | null;
        signals?: QuerySignals | null;
        sessionId?: string;
      } = {};
      try {
        data = await res.json();
      } catch {
        // fall through to the generic error below
      }

      if (!res.ok) {
        // Honest failure surface: configuration (503) and other errors show a
        // clear notice instead of a fabricated answer.
        const noticeText =
          data.message ||
          data.answer ||
          "Something went wrong processing that. Please try again.";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: noticeText, notice: true },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer ?? "",
          scores: data.scores || null,
          signals: data.signals || null,
        },
      ]);

      // Update sessionId if returned from server
      if (data.sessionId && data.sessionId !== currentSessionId) {
        setSessionId(data.sessionId);
        if (typeof window !== "undefined") {
          localStorage.setItem("sessionId", data.sessionId);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I couldn't reach the coaching service. Check your connection and try again.",
          notice: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    if (reportLoading) return;

    const resumeId =
      typeof window !== "undefined"
        ? localStorage.getItem("currentResumeId")
        : null;
    if (!resumeId) {
      toast("Upload a resume first", {
        description: "The full report is generated from your uploaded resume.",
      });
      return;
    }

    setReportLoading(true);
    setReportError(null);
    setReportMarkdown(null);

    try {
      const res = await fetch("/api/agents/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId }),
      });

      const text = await res.text();

      if (!res.ok) {
        setReportError(
          text || "The report could not be generated. Please try again.",
        );
        return;
      }

      setReportMarkdown(text);
    } catch {
      setReportError(
        "I couldn't reach the report service. Check your connection and try again.",
      );
    } finally {
      setReportLoading(false);
    }
  };

  const downloadReport = () => {
    if (!reportMarkdown || typeof window === "undefined") return;
    const blob = new Blob([reportMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "career-report.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-2xl min-h-[60vh] max-h-[85vh] flex flex-col bg-white/95 shadow-2xl">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-slate-800">AI Career Coach</h1>

          <p className="text-sm text-slate-600">
            Upload a resume → ask anything about it → answers stay grounded in
            the uploaded text.
          </p>
        </div>

        <ScrollArea
          className="flex-1 p-6"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className="text-center text-slate-500 mt-20">
              <p className="text-lg">Try asking:</p>

              <p className="mt-2 italic">
                &ldquo;Summarize my educational background.&rdquo;
              </p>

              <p className="italic">
                &ldquo;Which of my past roles is closest to data
                engineering?&rdquo;
              </p>

              <p className="italic">
                &ldquo;Walk me through the projects on my resume.&rdquo;
              </p>
            </div>
          )}

          {messages.map((m, i) => {
            const reNote =
              m.role === "assistant" && m.signals
                ? reretrievalNote(m.signals.reretrieval)
                : null;
            const routeToHuman = m.signals?.hitl.routeToHuman ?? false;
            const reviewTriggers = (m.signals?.hitl.triggers ?? [])
              .map((t) => TRIGGER_LABELS[t] ?? t)
              .filter(Boolean);

            return (
              <div
                key={i}
                className={`mb-4 ${m.role === "user" ? "text-right" : "text-left"}`}
              >
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
                    <span className="whitespace-pre-wrap break-words">
                      {m.content}
                    </span>
                  )}
                </div>

                {/* Confidence / HITL review banner — driven by the live
                    quality-gate signals (sparse data density, high-stakes
                    keyword, or an answer that did not clear the quality bar). */}
                {m.role === "assistant" && routeToHuman && (
                  <div
                    role="status"
                    className="mt-2 max-w-[90%] text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-2"
                    title={m.signals?.hitl.reason}
                  >
                    <AlertTriangle
                      className="h-4 w-4 shrink-0 mt-0.5"
                      aria-hidden
                    />
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
                      <AlertTriangle
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                      <span>
                        I&apos;m less confident about this response. Consider
                        verifying this information.
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
              </div>
            );
          })}

          {loading && (
            <p className="text-slate-500 italic" aria-live="polite">
              Thinking...
            </p>
          )}
          <div ref={messagesEndRef} />
        </ScrollArea>

        <div className="p-4 border-t">
          <label
            htmlFor="resume-upload"
            className="group flex items-center justify-between gap-3 px-4 py-3 rounded-md border border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:ring-offset-1"
          >
            <span className="text-sm text-slate-700 truncate">
              {resumeFileName ?? "Upload resume PDF"}
            </span>
            {resumeFileName && (
              <span className="text-xs text-slate-400 group-hover:text-slate-600 transition-colors shrink-0">
                Replace
              </span>
            )}
            <input
              id="resume-upload"
              type="file"
              accept=".pdf"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                const formData = new FormData();
                formData.append("file", file);
                formData.append("userId", "test-user");

                try {
                  const res = await fetch("/api/upload", {
                    method: "POST",
                    body: formData,
                  });
                  if (!res.ok) {
                    const text = await res.text();
                    toast.error("Upload failed", { description: text });
                    return;
                  }
                  const data = await res.json();
                  if (data.success) {
                    if (data.resumeId) {
                      localStorage.setItem("currentResumeId", data.resumeId);
                      setCurrentResumeId(data.resumeId);
                      setResumeFileName(file.name);
                    }
                    toast.success("Resume uploaded", {
                      description: `${data.chunks} chunks ingested.`,
                    });
                  } else {
                    toast.error("Upload error", {
                      description: data.error || "Unknown error",
                    });
                  }
                } catch (err: unknown) {
                  toast.error("Upload failed", {
                    description:
                      err instanceof Error ? err.message : "Unknown error",
                  });
                }
              }}
            />
          </label>
        </div>

        <div className="p-4 border-t flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Ask about my experience..."
              aria-label="Ask a question about the uploaded resume"
              className="flex-1"
              disabled={loading}
            />
            <Button onClick={sendMessage} disabled={loading}>
              Send
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={generateReport}
              disabled={reportLoading || !currentResumeId}
              aria-label="Generate a full career report from the uploaded resume"
            >
              {reportLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Generating report...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" aria-hidden />
                  Generate full report
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                localStorage.removeItem("currentResumeId");
                setCurrentResumeId(null);
                setResumeFileName(null);
                setReportMarkdown(null);
                setReportError(null);
                toast("Resume cleared", {
                  description: "Upload a new one to continue.",
                });
              }}
            >
              Clear Current Resume
            </Button>
          </div>
        </div>
      </Card>

      {/* Full-report panel: the 8-node LangGraph orchestrator (/api/agents/report),
          surfaced with explicit loading / error / result states. */}
      {(reportLoading || reportError || reportMarkdown) && (
        <Card className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-white/95 shadow-2xl">
          <div className="p-4 border-b flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Full career report
              </h2>
              <p className="text-xs text-slate-500">
                Multi-step agent: resume analysis, gap analysis, cover letter,
                interview prep, and a 6-month plan.
              </p>
            </div>
            {(reportMarkdown || reportError) && !reportLoading && (
              <button
                type="button"
                onClick={() => {
                  setReportMarkdown(null);
                  setReportError(null);
                }}
                aria-label="Dismiss report"
                className="text-slate-400 hover:text-slate-700 transition-colors shrink-0"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>

          {reportLoading && (
            <div
              className="flex items-center gap-2 p-6 text-slate-600"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              <span>
                Generating your full report — this runs several agent steps and
                can take a little while.
              </span>
            </div>
          )}

          {!reportLoading && reportError && (
            <div
              className="m-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-3 flex items-start gap-2"
              role="alert"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <div className="flex-1">
                <p className="font-medium">Couldn&apos;t generate the report.</p>
                <p className="mt-1 text-amber-800">{reportError}</p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={generateReport}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Try again
                </Button>
              </div>
            </div>
          )}

          {!reportLoading && reportMarkdown && (
            <>
              <ScrollArea className="flex-1 p-6" aria-label="Generated report">
                <div className="prose prose-sm prose-slate max-w-none break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {reportMarkdown}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
              <div className="p-4 border-t">
                <Button variant="outline" onClick={downloadReport}>
                  <FileText className="h-4 w-4" aria-hidden />
                  Download .md
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
