import { NextRequest } from 'next/server';
import { reportGraph } from '@/lib/report-graph';

interface RequestBody {
  resumeId: string;
  targetCompany?: string;
  targetRole?: string;
  jobDescription?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();
    const { resumeId, targetCompany: targetCompanyInput, targetRole: targetRoleInput, jobDescription } = body;

    // Validate resumeId
    if (!resumeId) {
      return new Response('Missing required field: resumeId', { status: 400 });
    }

    // Set defaults
    const targetCompany = targetCompanyInput ?? 'OpenAI';
    const targetRole = targetRoleInput ?? 'APM';

    console.log('Report graph: starting for resumeId', resumeId, 'targetCompany', targetCompany, 'targetRole', targetRole);

    // Invoke the LangGraph workflow
    const initialState = {
      resumeId,
      targetCompany,
      targetRole,
      jobDescription: jobDescription?.trim() || undefined,
    };

    const result = await reportGraph.invoke(initialState);

    // Check for errors in result
    if (result.error) {
      return new Response(`Error generating report: ${result.error}`, { status: 500 });
    }

    // Return the compiled report
    if (!result.reportMarkdown) {
      return new Response('Error: Report generation completed but no markdown was produced.', { status: 500 });
    }

    return new Response(result.reportMarkdown || '', {
      status: 200,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  } catch (error: any) {
    console.error('Report pipeline error:', error);
    return new Response(`Error generating report: ${error.message}`, { status: 500 });
  }
}

export const runtime = 'nodejs';

/*
 * REPORT PIPELINE SUMMARY (LangGraph Orchestration)
 * 
 * Data Flow:
 * 1. Client sends: { resumeId, targetCompany?, targetRole?, jobDescription? }
 * 2. Server invokes LangGraph workflow (lib/report-graph.ts)
 * 3. Graph executes nodes in orchestrated flow:
 *    - resumeContext: Retrieve resume chunks via RAG
 *    - resumeAnalysis: Analyze resume (with evaluation)
 *    - gapAnalysis: Analyze gaps (with evaluation)
 *    - jobMatching: Conditional - only if jobDescription provided
 *    - coverLetter: Generate cover letter (with evaluation)
 *    - interviewPrep + strategyPlan: Parallel execution (both with evaluation)
 *    - compileReport: Compile final markdown
 * 4. Client receives markdown and downloads as .md file
 * 
 * Graph Features:
 * - Conditional routing: Job matching only runs if jobDescription provided
 * - Parallel execution: Interview prep and strategy plan run simultaneously
 * - State management: All data flows through graph state
 * - Error handling: Graceful failures at each node
 * 
 * LLM Calls: 5-6 total (depending on jobDescription)
 * - All using gpt-4o-mini, temperature 0.2
 * 
 * The report content will clearly change based on:
 * - Different resumeId → different RAG chunks → different analysis
 * - Different targetCompany/targetRole → different gap analysis and tailored content
 * 
 * Server logs show each step: resumeContext, resumeAnalysis, gapAnalysis, jobMatching (conditional), coverLetter, interviewPrep, strategyPlan, compileReport
 */
