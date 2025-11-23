'use client';



import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import { ScrollArea } from '@/components/ui/scroll-area';

import { Card } from '@/components/ui/card';



export default function Home() {

  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);

  const [input, setInput] = useState('');

  const [loading, setLoading] = useState(false);



  const sendMessage = async () => {

    if (!input.trim() || loading) return;



    const userMessage = input;

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    setInput('');

    setLoading(true);



    const res = await fetch('/api/query', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ query: userMessage }),

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
              const res = await fetch('/api/ingest', { method: 'POST', body: formData });
              const data = await res.json();
              alert(data.success ? 'Resume uploaded!' : 'Error: ' + data.error);
            }}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
          />
        </div>

        <div className="p-4 border-t flex gap-2">

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

      </Card>

    </div>

  );

}
