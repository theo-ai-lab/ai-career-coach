'use client';



import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import { ScrollArea } from '@/components/ui/scroll-area';

import { Card } from '@/components/ui/card';



export default function Home() {

  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);

  const [input, setInput] = useState('');

  const [jobDescription, setJobDescription] = useState('');

  const [loading, setLoading] = useState(false);

  const [currentResumeId, setCurrentResumeId] = useState<string | null>(

    typeof window !== 'undefined' ? localStorage.getItem('currentResumeId') : null

  );

  const [reportLoading, setReportLoading] = useState(false);



  const sendMessage = async () => {

    if (!input.trim() || loading) return;



    const userMessage = input;

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    setInput('');

    setLoading(true);



    const resumeId = typeof window !== 'undefined' ? localStorage.getItem('currentResumeId') : null;

    const res = await fetch('/api/query', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ query: userMessage, resumeId }),

    });



    const data = await res.json();

    setMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);

    setLoading(false);

  };



  return (

    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">

      <Card className="w-full max-w-2xl h-[80vh] flex flex-col bg-white/95 shadow-2xl">

        <div className="p-6 border-b">

          <h1 className="text-2xl font-bold text-slate-800">AI Career Coach</h1>

          <p className="text-sm text-slate-600">Upload your resume → get coaching grounded in your actual experience</p>

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
            className="border border-slate-200 bg-slate-50"
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
            className="border border-slate-200 bg-slate-50"
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
                alert("Cover letter ready!\n\n" + json.letter.letter);
              } catch (err: any) {
                alert("Failed to generate cover letter: " + (err?.message ?? "Unknown error"));
              }
            }}
          >
            Generate Cover Letter
          </Button>

          <Button
            variant="outline"
            className="border border-slate-200 bg-slate-50"
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
                alert("Interview prep ready! 10 questions with perfect answers generated.");
                console.log(json.prep);
              } catch (err: any) {
                alert("Failed to generate interview prep: " + (err?.message ?? "Unknown error"));
              }
            }}
          >
            Generate Interview Prep
          </Button>

          <Button
            variant="outline"
            className="border border-slate-200 bg-slate-50"
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
                alert("Your 6-month plan to land OpenAI is ready! Check the console for details.");
                console.log(json.plan);
              } catch (err: any) {
                alert("Failed to generate strategy plan: " + (err?.message ?? "Unknown error"));
              }
            }}
          >
            Generate My 6-Month Plan
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

                const payload: any = {
                  resumeId,
                  targetCompany: "OpenAI",
                  targetRole: "APM",
                };

                if (jobDescription.trim()) {
                  payload.jobDescription = jobDescription.trim();
                }

                const res = await fetch("/api/agents/report", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
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
          <div className="mt-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Optional: Paste a target job description to personalize the report
            </label>
            <textarea
              className="w-full border rounded-md p-2 text-sm min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Paste a job description here (e.g., Product Manager role at OpenAI)..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
            />
          </div>
        </div>

      </Card>

    </div>

  );

}

