"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/notice";
import { TypingIndicator } from "@/components/typing-indicator";
import {
  ChatMessage,
  type Message,
  type QuerySignals,
  type Scores,
} from "@/components/chat-message";

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

  // Upload failures render as a persistent designed notice under the
  // upload control (not a transient toast): a 503/400 explains itself
  // for as long as the visitor needs to read it.
  const [uploadError, setUploadError] = useState<string | null>(null);

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
        // Honest failure surface: configuration (503), rate limits (429),
        // and other errors render as a designed notice instead of a
        // fabricated answer (ChatMessage routes notices through Notice).
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
    <div className="page-canvas flex min-h-screen flex-col items-center justify-center gap-4 p-4 sm:p-6">
      <Card className="flex max-h-[85vh] min-h-[60vh] w-full max-w-2xl flex-col shadow-lg">
        <div className="border-b p-6">
          <h1 className="font-serif text-xl font-medium tracking-tight text-foreground-strong">
            AI Career Coach
          </h1>

          <p className="mt-1.5 text-sm text-muted-foreground">
            Upload a résumé, then ask anything about it — answers stay grounded
            in the uploaded text.
          </p>

          {/* The live path needs an OpenAI key + Supabase; the demo does not.
              Keep the keyless entry point one click away so a visitor on an
              unconfigured deployment still experiences the quality gates. */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            No backend configured?{" "}
            <Link
              href="/demo"
              className="font-medium text-accent-foreground underline underline-offset-2 hover:text-primary-hover"
            >
              Try the keyless demo
            </Link>{" "}
            — same gates, committed demo data, no API key.
          </p>
        </div>

        <ScrollArea
          className="flex-1 p-6"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className="mt-14 flex flex-col items-center text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Sparkles className="h-5 w-5" aria-hidden />
              </div>
              <p className="mt-4 font-serif text-lg font-medium text-foreground-strong">
                Ask about the résumé you upload.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <li className="font-serif italic">
                  &ldquo;Summarize my educational background.&rdquo;
                </li>
                <li className="font-serif italic">
                  &ldquo;Which of my past roles is closest to data
                  engineering?&rdquo;
                </li>
                <li className="font-serif italic">
                  &ldquo;Walk me through the projects on my resume.&rdquo;
                </li>
              </ul>
            </div>
          )}

          {messages.map((m, i) => (
            <ChatMessage key={i} message={m} />
          ))}

          {loading && <TypingIndicator label="Thinking" />}
          <div ref={messagesEndRef} />
        </ScrollArea>

        <div className="border-t p-4">
          <label
            htmlFor="resume-upload"
            className="group flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-offset-1 hover:border-input hover:bg-secondary"
          >
            <span className="truncate text-sm text-foreground">
              {resumeFileName ?? "Upload resume PDF"}
            </span>
            {resumeFileName && (
              <span className="shrink-0 text-xs text-muted-foreground transition-colors group-hover:text-accent-foreground">
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

                setUploadError(null);

                const formData = new FormData();
                formData.append("file", file);
                formData.append("userId", "test-user");

                try {
                  const res = await fetch("/api/upload", {
                    method: "POST",
                    body: formData,
                  });
                  if (!res.ok) {
                    // Error responses are JSON with a designed, human-readable
                    // message (503 service_unavailable payloads, 400 field
                    // problems) — surface that on the notice surface, never
                    // raw JSON.
                    const text = await res.text();
                    let description = text;
                    try {
                      const body = JSON.parse(text);
                      description =
                        body.message || body.error || "Unknown error";
                    } catch {
                      // Non-JSON body (unexpected): show it as-is.
                    }
                    setUploadError(description);
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
                    setUploadError(data.error || "Unknown error");
                  }
                } catch (err: unknown) {
                  setUploadError(
                    err instanceof Error ? err.message : "Unknown error",
                  );
                }
              }}
            />
          </label>

          {uploadError && (
            <Notice
              tone="caution"
              icon={AlertTriangle}
              role="alert"
              title="Upload failed."
              className="mt-3"
            >
              <p className="mt-0.5">{uploadError}</p>
            </Notice>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t p-4">
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
                setUploadError(null);
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
        <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col shadow-lg">
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-serif text-md font-medium tracking-tight text-foreground-strong">
                Full career report
              </h2>
              <p className="text-xs text-muted-foreground">
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
                className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>

          {reportLoading && (
            <div
              className="flex items-center gap-2.5 p-6 text-sm text-muted-foreground"
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
            <Notice
              tone="caution"
              icon={AlertTriangle}
              role="alert"
              title="Couldn't generate the report."
              className="m-4"
            >
              <p className="mt-0.5">{reportError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={generateReport}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Try again
              </Button>
            </Notice>
          )}

          {!reportLoading && reportMarkdown && (
            <>
              <ScrollArea className="flex-1 p-6" aria-label="Generated report">
                <div className="rich-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {reportMarkdown}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
              <div className="border-t p-4">
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
