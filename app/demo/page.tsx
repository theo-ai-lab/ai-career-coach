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
import { FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { TypingIndicator } from "@/components/typing-indicator";
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
  message?: string;
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
        // Rate limits (429) carry a designed `message`; older error bodies
        // carry `answer`. Either way it renders on the notice surface.
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              data.message ||
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
    <div className="page-canvas flex min-h-screen flex-col items-center justify-center gap-4 p-4 sm:p-6">
      <Card className="flex max-h-[85vh] min-h-[60vh] w-full max-w-2xl flex-col shadow-lg">
        <div className="border-b p-6">
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-xl font-medium tracking-tight text-foreground-strong">
              AI Career Coach
            </h1>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold tracking-wider text-accent-foreground uppercase">
              Keyless demo
            </span>
          </div>

          {/* Persistent honesty label: what is synthetic on this page. */}
          <p
            className="mt-1.5 text-xs font-medium text-muted-foreground"
            data-testid="demo-mode-label"
          >
            {DEMO_MODE_LABEL}
          </p>

          <p className="mt-2 text-sm text-muted-foreground">
            You are chatting over the résumé of{" "}
            <span className="font-serif italic text-foreground">
              {DEMO_PERSONA_NAME}
            </span>
            , a fictional persona. The gates are the same TypeScript the live
            path runs — conformal OOD abstention and human-review routing —
            over a deterministic demo embedding space. Answers are canned or
            verbatim excerpts (no model call), so what you are evaluating here
            is the gating, not generative quality.
          </p>

          <p className="mt-1.5 text-xs text-muted-foreground">
            Have keys configured?{" "}
            <Link
              href="/"
              className="font-medium text-accent-foreground underline underline-offset-2 hover:text-primary-hover"
            >
              Use the live coach
            </Link>
            .
          </p>
        </div>

        {/* One-click scripted queries, each locked by tests to a documented
            gate outcome (lib/demo/run-demo-query.test.ts). */}
        <div className="flex flex-wrap gap-2 border-b px-6 py-3">
          {SCRIPTED_DEMO_QUERIES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => sendQuery(s.query)}
              disabled={loading}
              title={s.demonstrates}
              className="rounded-full bg-secondary px-3.5 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
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
            <div className="mt-12 flex flex-col items-center text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <FlaskConical className="h-5 w-5" aria-hidden />
              </div>
              <p className="mt-4 font-serif text-lg font-medium text-foreground-strong">
                Pick a scripted question above, or ask anything.
              </p>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                On-résumé questions get a grounded answer. Off-résumé questions
                hit the calibrated abstention gate instead of a made-up answer
                — that&apos;s the point.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <ChatMessage key={i} message={m} />
          ))}

          {loading && <TypingIndicator label="Running the gates" />}
          <div ref={messagesEndRef} />
        </ScrollArea>

        <div className="flex gap-2 border-t p-4">
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
            Send
          </Button>
        </div>
      </Card>

      <p className="max-w-2xl text-center text-xs text-muted-foreground">
        Demo honesty: the persona is fictional, the embedding space is a
        deterministic hashed-lexical construction (not a learned model), and
        answers are canned or verbatim excerpts — but the abstention threshold
        is genuinely conformal-calibrated on this space and every gate decision
        you see is made by the production gate code at request time.
      </p>
    </div>
  );
}
