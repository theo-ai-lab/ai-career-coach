"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { ScrollArea } from "@/components/ui/scroll-area";

import { Card } from "@/components/ui/card";

interface Message {
  role: "user" | "assistant";
  content: string;
  scores?: {
    overall: number;
    actionability: number;
    personalization: number;
    honesty: number;
    grounding: number;
  } | null;
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

  const [sessionId, setSessionId] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("sessionId") : null,
  );

  const [resumeFileName, setResumeFileName] = useState<string | null>(null);

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

    const data = await res.json();

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: data.answer,
        scores: data.scores || null,
      },
    ]);

    // Update sessionId if returned from server
    if (data.sessionId && data.sessionId !== currentSessionId) {
      setSessionId(data.sessionId);
      if (typeof window !== "undefined") {
        localStorage.setItem("sessionId", data.sessionId);
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl min-h-[60vh] max-h-[85vh] flex flex-col bg-white/95 shadow-2xl">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-slate-800">AI Career Coach</h1>

          <p className="text-sm text-slate-600">
            Upload a resume → ask anything about it → answers stay grounded in
            the uploaded text.
          </p>
        </div>

        <ScrollArea className="flex-1 p-6">
          {messages.length === 0 && (
            <div className="text-center text-slate-500 mt-20">
              <p className="text-lg">Try asking:</p>

              <p className="mt-2 italic">
                "Summarize my educational background."
              </p>

              <p className="italic">
                "Which of my past roles is closest to data engineering?"
              </p>

              <p className="italic">
                "Walk me through the projects on my resume."
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`mb-4 ${m.role === "user" ? "text-right" : "text-left"}`}
            >
              <div
                className={`inline-block p-3 rounded-lg max-w-md ${
                  m.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-800"
                }`}
              >
                {m.content}
              </div>

              {/* Low Confidence Warning (only when score < 75) */}
              {m.role === "assistant" && m.scores && m.scores.overall < 75 && (
                <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                  <span>⚠️</span>
                  <span>
                    I'm less confident about this response. Consider verifying
                    this information.
                  </span>
                </div>
              )}
            </div>
          ))}

          {loading && <p className="text-slate-500 italic">Thinking...</p>}
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
                    alert("Upload failed: " + text);
                    return;
                  }
                  const data = await res.json();
                  if (data.success) {
                    if (data.resumeId) {
                      localStorage.setItem("currentResumeId", data.resumeId);
                      setCurrentResumeId(data.resumeId);
                      setResumeFileName(file.name);
                    }
                    alert(`Resume uploaded. ${data.chunks} chunks ingested.`);
                  } else {
                    alert("Error: " + (data.error || "Unknown error"));
                  }
                } catch (err: any) {
                  alert("Upload failed: " + (err?.message ?? "Unknown error"));
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
              className="flex-1"
              disabled={loading}
            />
            <Button onClick={sendMessage} disabled={loading}>
              Send
            </Button>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              localStorage.removeItem("currentResumeId");
              setCurrentResumeId(null);
              alert("Resume cleared! Upload a new one.");
            }}
          >
            Clear Current Resume
          </Button>
        </div>
      </Card>
    </div>
  );
}
