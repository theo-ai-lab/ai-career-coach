'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';

interface EvalScore {
  actionability: number;
  personalization: number;
  honesty: number;
  grounding: number;
}

interface Eval {
  id: string;
  response_id: string | null;
  query: string;
  response: string;
  contexts: string[];
  scores: EvalScore;
  reasoning: string;
  overall_score: number;
  created_at: string;
}

interface EvalStats {
  avgActionability: number;
  avgPersonalization: number;
  avgHonesty: number;
  avgGrounding: number;
  avgOverall: number;
  totalEvals: number;
}

export default function EvalsDashboard() {
  const [evals, setEvals] = useState<Eval[]>([]);
  const [stats, setStats] = useState<EvalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEval, setSelectedEval] = useState<Eval | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEvals();
  }, []);

  async function fetchEvals() {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/evals');
      if (!res.ok) {
        throw new Error('Failed to fetch evals');
      }
      const data = await res.json();
      setEvals(data.evals || []);
      setStats(data.stats || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const lowestScoring = [...evals]
    .sort((a, b) => a.overall_score - b.overall_score)
    .slice(0, 10);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <Card className="p-8 bg-white/95">
          <p className="text-slate-600">Loading evaluations...</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <Card className="p-8 bg-white/95">
          <p className="text-red-600">Error: {error}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="max-w-7xl mx-auto">
        <Card className="p-6 bg-white/95 mb-6">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Coaching Quality Dashboard</h1>
          <p className="text-slate-600">Evaluation scores for AI coaching responses</p>
        </Card>

        {stats && (
          <Card className="p-6 bg-white/95 mb-6">
            <h2 className="text-xl font-bold text-slate-800 mb-4">
              Average Scores (Last {stats.totalEvals} Responses)
            </h2>
            <div className="grid grid-cols-5 gap-4">
              <div>
                <p className="text-sm text-slate-600 mb-1">Actionability</p>
                <p className="text-2xl font-bold text-slate-800">
                  {stats.avgActionability.toFixed(1)}/5
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Personalization</p>
                <p className="text-2xl font-bold text-slate-800">
                  {stats.avgPersonalization.toFixed(1)}/5
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Honesty</p>
                <p className="text-2xl font-bold text-slate-800">
                  {stats.avgHonesty.toFixed(1)}/5
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Grounding</p>
                <p className="text-2xl font-bold text-slate-800">
                  {stats.avgGrounding.toFixed(1)}/5
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Overall</p>
                <p className="text-2xl font-bold text-blue-600">
                  {stats.avgOverall.toFixed(1)}/100
                </p>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 bg-white/95">
            <h2 className="text-xl font-bold text-slate-800 mb-4">
              Lowest Scoring Responses
            </h2>
            <div className="space-y-3">
              {lowestScoring.length === 0 ? (
                <p className="text-slate-500">No evaluations yet</p>
              ) : (
                lowestScoring.map((evalItem) => (
                  <div
                    key={evalItem.id}
                    className="p-3 border border-slate-200 rounded cursor-pointer hover:bg-slate-50"
                    onClick={() => setSelectedEval(evalItem)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm font-medium text-slate-800">
                        Overall: {evalItem.overall_score.toFixed(1)}/100
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(evalItem.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <p className="text-xs text-slate-600 truncate">
                      {evalItem.query.substring(0, 80)}...
                    </p>
                    <div className="flex gap-2 mt-2 text-xs">
                      <span className="text-slate-600">
                        A:{evalItem.scores.actionability} P:{evalItem.scores.personalization} H:{evalItem.scores.honesty} G:{evalItem.scores.grounding}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {selectedEval && (
            <Card className="p-6 bg-white/95">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-bold text-slate-800">Evaluation Details</h2>
                <button
                  onClick={() => setSelectedEval(null)}
                  className="text-slate-500 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Query</p>
                  <p className="text-sm text-slate-800 bg-slate-50 p-2 rounded">
                    {selectedEval.query}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Response</p>
                  <p className="text-sm text-slate-800 bg-slate-50 p-2 rounded max-h-40 overflow-y-auto">
                    {selectedEval.response}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-600 mb-2">Scores</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 p-2 rounded">
                      <p className="text-xs text-slate-600">Actionability</p>
                      <p className="text-lg font-bold text-slate-800">
                        {selectedEval.scores.actionability}/5
                      </p>
                    </div>
                    <div className="bg-slate-50 p-2 rounded">
                      <p className="text-xs text-slate-600">Personalization</p>
                      <p className="text-lg font-bold text-slate-800">
                        {selectedEval.scores.personalization}/5
                      </p>
                    </div>
                    <div className="bg-slate-50 p-2 rounded">
                      <p className="text-xs text-slate-600">Honesty</p>
                      <p className="text-lg font-bold text-slate-800">
                        {selectedEval.scores.honesty}/5
                      </p>
                    </div>
                    <div className="bg-slate-50 p-2 rounded">
                      <p className="text-xs text-slate-600">Grounding</p>
                      <p className="text-lg font-bold text-slate-800">
                        {selectedEval.scores.grounding}/5
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 bg-blue-50 p-2 rounded">
                    <p className="text-xs text-slate-600">Overall Score</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {selectedEval.overall_score.toFixed(1)}/100
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Reasoning</p>
                  <p className="text-sm text-slate-800 bg-slate-50 p-2 rounded">
                    {selectedEval.reasoning}
                  </p>
                </div>

                {selectedEval.contexts && selectedEval.contexts.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-slate-600 mb-1">
                      Contexts ({selectedEval.contexts.length})
                    </p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {selectedEval.contexts.map((ctx, i) => (
                        <p key={i} className="text-xs text-slate-600 bg-slate-50 p-2 rounded">
                          {ctx.substring(0, 100)}...
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

