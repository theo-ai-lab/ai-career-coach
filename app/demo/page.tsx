"use client";

/**
 * Keyless demo (/demo). Everything on this page runs without an OpenAI key,
 * a Supabase connection, or any env var: retrieval, the conformal OOD
 * abstention gate, and density/HITL routing all execute the REAL gate code
 * server-side over committed demo data (see lib/demo/run-demo-query.ts for
 * the exact real-vs-canned inventory).
 *
 * The honesty label — demo corpus · deterministic demo embeddings · canned
 * generation — is rendered persistently in the header AND as a per-answer
 * provenance caption, so any screenshot or recording of this page carries it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FlaskConical, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import {
  ChatMessage,
  type Message,
  type QuerySignals,
} from "@/components/chat-message";
import {
  SCRIPTED_DEMO_QUERIES,
  DEMO_MODE_LABEL,
  DEMO_PERSONA_NAME,
} from "@/lib/demo/scripted-queries";

interface DemoApiResponse {
  answer?: string;
  signals?: QuerySignals | null;
  demo?: {
    label: string;
    generationNote: string;
  };
}

export default function DemoPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendQuery = async (query: string) => {
    if (!query.trim() || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/demo/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      let data: DemoApiResponse = {};
      try {
        data = await res.json();
      } catch {
        // fall through to the generic error below
      }

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              data.answer ||
              "Something went wrong processing that. Please try again.",
            notice: true,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer ?? "",
          scores: null,
          signals: data.signals || null,
          demoNote: data.demo?.generationNote,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I couldn't reach the demo service. Check your connection and try again.",
          notice: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center gap-4 p-4">
      <Card className="w-full max-w-2xl min-h-[60vh] max-h-[85vh] flex flex-col bg-white/95 shadow-2xl">
        <div className="p-6 border-b">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-800">
              AI Career Coach
            </h1>
            <span className="text-xs font-medium uppercase tracking-wide text-sky-800 bg-sky-50 border border-sky-200 rounded px-2 py-0.5">
              Keyless demo
            </span>
          </div>

          {/* Persistent honesty label: what is synthetic on this page. */}
          <p
            className="mt-1 text-xs font-medium text-slate-500"
            data-testid="demo-mode-label"
          >
            {DEMO_MODE_LABEL}
          </p>

          <p className="mt-2 text-sm text-slate-600">
            You are chatting over the résumé of{" "}
            <span className="font-medium">{DEMO_PERSONA_NAME}</span>, a
            fictional persona. The gates are the same TypeScript the live path
            runs — conformal OOD abstention and human-review routing — over a
            deterministic demo embedding space. Answers are canned or verbatim
            excerpts (no model call), so what you are evaluating here is the
            gating, not generative quality.
          </p>

          <p className="mt-1 text-xs text-slate-500">
            Have keys configured?{" "}
            <Link
              href="/"
              className="underline underline-offset-2 hover:text-slate-700"
            >
              Use the live coach
            </Link>
            .
          </p>
        </div>

        {/* One-click scripted queries, each locked by tests to a documented
            gate outcome (lib/demo/run-demo-query.test.ts). */}
        <div className="px-6 py-3 border-b flex flex-wrap gap-2">
          {SCRIPTED_DEMO_QUERIES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => sendQuery(s.query)}
              disabled={loading}
              title={s.demonstrates}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>

        <ScrollArea
          className="flex-1 p-6"
          role="log"
          aria-live="polite"
          aria-label="Demo conversation"
        >
          {messages.length === 0 && (
            <div className="text-center text-slate-500 mt-16">
              <FlaskConical
                className="h-6 w-6 mx-auto mb-3 text-slate-400"
                aria-hidden
              />
              <p className="text-lg">
                Pick a scripted question above, or ask anything.
              </p>
              <p className="mt-2 text-sm">
                On-résumé questions get a grounded answer. Off-résumé
                questions hit the calibrated abstention gate instead of a
                made-up answer — that&apos;s the point.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <ChatMessage key={i} message={m} />
          ))}

          {loading && (
            <p className="text-slate-500 italic" aria-live="polite">
              Running the gates...
            </p>
          )}
          <div ref={messagesEndRef} />
        </ScrollArea>

        <div className="p-4 border-t flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendQuery(input)}
            placeholder="Ask about the demo résumé..."
            aria-label="Ask a question about the demo resume"
            className="flex-1"
            disabled={loading}
          />
          <Button onClick={() => sendQuery(input)} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              "Send"
            )}
          </Button>
        </div>
      </Card>

      <p className="text-xs text-slate-400 max-w-2xl text-center">
        Demo honesty: the persona is fictional, the embedding space is a
        deterministic hashed-lexical construction (not a learned model), and
        answers are canned or verbatim excerpts — but the abstention threshold
        is genuinely conformal-calibrated on this space and every gate decision
        you see is made by the production gate code at request time.
      </p>
    </div>
  );
}
