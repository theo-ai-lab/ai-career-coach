'use client';



import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import { ScrollArea } from '@/components/ui/scroll-area';

import { Card } from '@/components/ui/card';

import { HITLWarning } from '@/components/HITLWarning';



interface Message {
  role: 'user' | 'assistant';
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

  const [input, setInput] = useState('');

  const [loading, setLoading] = useState(false);

  const [currentResumeId, setCurrentResumeId] = useState<string | null>(

    typeof window !== 'undefined' ? localStorage.getItem('currentResumeId') : null

  );

  const [sessionId, setSessionId] = useState<string | null>(

    typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null

  );

  const [reportLoading, setReportLoading] = useState(false);

  // Agent output state
  const [coverLetterOutput, setCoverLetterOutput] = useState<{
    content: any;
    highStakes: boolean;
  } | null>(null);
  const [interviewPrepOutput, setInterviewPrepOutput] = useState<{
    content: any;
    highStakes: boolean;
  } | null>(null);
  const [strategyOutput, setStrategyOutput] = useState<{
    content: any;
    highStakes: boolean;
  } | null>(null);



  const sendMessage = async () => {

    if (!input.trim() || loading) return;



    const userMessage = input;

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    setInput('');

    setLoading(true);



    const resumeId = typeof window !== 'undefined' ? localStorage.getItem('currentResumeId') : null;
    
    // Get or create sessionId
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = crypto.randomUUID();
      setSessionId(currentSessionId);
      if (typeof window !== 'undefined') {
        localStorage.setItem('sessionId', currentSessionId);
      }
    }

    // Send messages array for session summarization
    const res = await fetch('/api/query', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ 
        query: userMessage, 
        resumeId,
        sessionId: currentSessionId,
        messages: messages.map(m => ({ role: m.role, content: m.content }))
      }),

    });



    const data = await res.json();

    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: data.answer,
      scores: data.scores || null
    }]);
    
    // Update sessionId if returned from server
    if (data.sessionId && data.sessionId !== currentSessionId) {
      setSessionId(data.sessionId);
      if (typeof window !== 'undefined') {
        localStorage.setItem('sessionId', data.sessionId);
      }
    }

    setLoading(false);

  };



  return (

    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">

      <Card className="w-full max-w-2xl h-[80vh] flex flex-col bg-white/95 shadow-2xl">

        <div className="p-6 border-b">

          <h1 className="text-2xl font-bold text-slate-800">AI Career Coach</h1>

          <p className="text-sm text-slate-600">Ask anything about my background → I'll answer using only my real resume</p>

        </div>



        <ScrollArea className="flex-1 p-6">

          {messages.length === 0 && (

            <div className="text-center text-slate-500 mt-20">

              <p className="text-lg">Try asking:</p>

              <p className="mt-2 italic">"What is my educational background?"</p>

              <p className="italic">"What technical experience do I have with RAG?"</p>

              <p className="italic">"Which companies am I targeting?"</p>

            </div>

          )}

          {messages.map((m, i) => (

            <div key={i} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>

              <div className={`inline-block p-3 rounded-lg max-w-md ${

                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-800'

              }`}>

                {m.content}

              </div>

              {/* Low Confidence Warning (only when score < 75) */}
              {m.role === 'assistant' && m.scores && m.scores.overall < 75 && (
                <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                  <span>⚠️</span>
                  <span>I'm less confident about this response. Consider verifying this information.</span>
                </div>
              )}

            </div>

          ))}

          {loading && <p className="text-slate-500 italic">Thinking...</p>}

        </ScrollArea>



        <div className="p-4 border-t">
          <input
            type="file"
            accept=".pdf"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              
              const formData = new FormData();
              formData.append('file', file);
              formData.append('userId', 'test-user'); // Required by /api/upload
              
              try {
                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                if (!res.ok) {
                  const text = await res.text();
                  alert('Upload failed: ' + text);
                  return;
                }
                const data = await res.json();
                if (data.success) {
                  if (data.resumeId) {
                    localStorage.setItem('currentResumeId', data.resumeId);
                    setCurrentResumeId(data.resumeId);
                  }
                  alert(`✅ Resume uploaded successfully! ${data.chunks} chunks ingested.`);
                } else {
                  alert('Error: ' + (data.error || 'Unknown error'));
                }
              } catch (err: any) {
                alert('Upload failed: ' + (err?.message ?? 'Unknown error'));
              }
            }}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
          />
        </div>

        <div className="p-4 border-t flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
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
              localStorage.removeItem('currentResumeId');
              setCurrentResumeId(null);
              alert('Resume cleared! Upload a new one.');
            }}
          >
            Clear Current Resume
          </Button>

          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch("/api/agents/cover-letter", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    // In a real flow these would come from previous agent runs.
                    resumeAnalysis: {},
                    gapAnalysis: {},
                    company: "OpenAI",
                  }),
                });
                const json = await res.json();
                if (!res.ok || !json.letter) {
                  alert("Failed to generate cover letter: " + (json.error ?? "Unknown error"));
                  return;
                }
                setCoverLetterOutput({
                  content: json.letter,
                  highStakes: json.highStakes || false,
                });
              } catch (err: any) {
                alert("Failed to generate cover letter: " + (err?.message ?? "Unknown error"));
              }
            }}
          >
            Generate Cover Letter for OpenAI
          </Button>

          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch("/api/agents/interview-prep", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    // In a real flow these would come from previous agent runs.
                    resumeAnalysis: {},
                    gapAnalysis: {},
                    jobDescription: "APM role at OpenAI working on AI-native product experiences.",
                    company: "OpenAI",
                  }),
                });
                const json = await res.json();
                if (!res.ok || !json.prep) {
                  alert("Failed to generate interview prep: " + (json.error ?? "Unknown error"));
                  return;
                }
                setInterviewPrepOutput({
                  content: json.prep,
                  highStakes: json.highStakes || false,
                });
              } catch (err: any) {
                alert("Failed to generate interview prep: " + (err?.message ?? "Unknown error"));
              }
            }}
          >
            Generate Interview Prep for OpenAI
          </Button>

          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await fetch("/api/agents/strategy", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    // In a real flow these would come from previous agent runs.
                    resumeAnalysis: {},
                    gapAnalysis: {},
                    targetCompany: "OpenAI",
                  }),
                });
                const json = await res.json();
                if (!res.ok || !json.plan) {
                  alert("Failed to generate strategy plan: " + (json.error ?? "Unknown error"));
                  return;
                }
                setStrategyOutput({
                  content: json.plan,
                  highStakes: json.highStakes || false,
                });
              } catch (err: any) {
                alert("Failed to generate strategy plan: " + (err?.message ?? "Unknown error"));
              }
            }}
          >
            Generate My 6-Month Plan → OpenAI
          </Button>

          <Button
            variant="default"
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold"
            disabled={reportLoading}
            onClick={async () => {
              try {
                // Read resumeId from localStorage
                const resumeId = typeof window !== 'undefined' ? localStorage.getItem('currentResumeId') : null;
                if (!resumeId) {
                  alert("Please upload a resume first so I can analyze it.");
                  return;
                }

                setReportLoading(true);

                const res = await fetch("/api/agents/report", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    resumeId,
                    targetCompany: "OpenAI",
                    targetRole: "APM",
                    jobDescription: "APM role at OpenAI working on AI-native product experiences.",
                  }),
                });
                if (!res.ok) {
                  const text = await res.text();
                  alert("Failed to generate report: " + text);
                  setReportLoading(false);
                  return;
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                // The server returns a .md filename; browser will still let you export to PDF via Print.
                a.download = "Theo_Bermudez_OpenAI_Career_Report.md";
                a.click();
                URL.revokeObjectURL(url);
              } catch (err: any) {
                alert("Failed to download report: " + (err?.message ?? "Unknown error"));
              } finally {
                setReportLoading(false);
              }
            }}
          >
            {reportLoading ? "Generating Report..." : "Download Full Career Report (Markdown → export to PDF)"}
          </Button>
        </div>

      </Card>

      {/* Cover Letter Output Modal */}
      {coverLetterOutput && (
        <Card className="fixed inset-4 bg-white z-50 overflow-auto shadow-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Cover Letter</h2>
            <Button variant="outline" onClick={() => setCoverLetterOutput(null)}>
              Close
            </Button>
          </div>
          <div className="mb-4 p-4 bg-slate-50 rounded-lg whitespace-pre-wrap">
            {coverLetterOutput.content.letter || JSON.stringify(coverLetterOutput.content, null, 2)}
          </div>
          {coverLetterOutput.highStakes && (
            <HITLWarning
              onDownload={() => {
                const text = coverLetterOutput.content.letter || JSON.stringify(coverLetterOutput.content, null, 2);
                navigator.clipboard.writeText(text);
                alert("Cover letter copied to clipboard!");
              }}
              downloadLabel="Copy Cover Letter"
            />
          )}
          {!coverLetterOutput.highStakes && (
            <Button
              onClick={() => {
                const text = coverLetterOutput.content.letter || JSON.stringify(coverLetterOutput.content, null, 2);
                navigator.clipboard.writeText(text);
                alert("Cover letter copied to clipboard!");
              }}
            >
              Copy Cover Letter
            </Button>
          )}
        </Card>
      )}

      {/* Interview Prep Output Modal */}
      {interviewPrepOutput && (
        <Card className="fixed inset-4 bg-white z-50 overflow-auto shadow-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Interview Preparation</h2>
            <Button variant="outline" onClick={() => setInterviewPrepOutput(null)}>
              Close
            </Button>
          </div>
          <div className="mb-4 p-4 bg-slate-50 rounded-lg">
            <pre className="whitespace-pre-wrap text-sm">
              {JSON.stringify(interviewPrepOutput.content, null, 2)}
            </pre>
          </div>
          {interviewPrepOutput.highStakes && (
            <HITLWarning
              onDownload={() => {
                const text = JSON.stringify(interviewPrepOutput.content, null, 2);
                navigator.clipboard.writeText(text);
                alert("Interview prep copied to clipboard!");
              }}
              downloadLabel="Copy Interview Prep"
            />
          )}
          {!interviewPrepOutput.highStakes && (
            <Button
              onClick={() => {
                const text = JSON.stringify(interviewPrepOutput.content, null, 2);
                navigator.clipboard.writeText(text);
                alert("Interview prep copied to clipboard!");
              }}
            >
              Copy Interview Prep
            </Button>
          )}
        </Card>
      )}

      {/* Strategy Output Modal */}
      {strategyOutput && (
        <Card className="fixed inset-4 bg-white z-50 overflow-auto shadow-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">6-Month Strategy Plan</h2>
            <Button variant="outline" onClick={() => setStrategyOutput(null)}>
              Close
            </Button>
          </div>
          <div className="mb-4 p-4 bg-slate-50 rounded-lg">
            <pre className="whitespace-pre-wrap text-sm">
              {JSON.stringify(strategyOutput.content, null, 2)}
            </pre>
          </div>
          {strategyOutput.highStakes && (
            <HITLWarning
              onDownload={() => {
                const text = JSON.stringify(strategyOutput.content, null, 2);
                navigator.clipboard.writeText(text);
                alert("Strategy plan copied to clipboard!");
              }}
              downloadLabel="Copy Strategy Plan"
            />
          )}
          {!strategyOutput.highStakes && (
            <Button
              onClick={() => {
                const text = JSON.stringify(strategyOutput.content, null, 2);
                navigator.clipboard.writeText(text);
                alert("Strategy plan copied to clipboard!");
              }}
            >
              Copy Strategy Plan
            </Button>
          )}
        </Card>
      )}

    </div>

  );

}

