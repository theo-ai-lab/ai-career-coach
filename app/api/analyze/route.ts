// app/api/analyze/route.ts

import { careerAgent } from '@/lib/agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    console.log('Starting analysis...');
    // Start with empty state - the agents will populate it
    const result: any = await careerAgent.invoke({});

    if (!result || !result.finalReport) {
      throw new Error('No report generated from agent');
    }

    return Response.json({ report: result.finalReport });
  } catch (error: any) {
    console.error('Analysis error:', error);
    return Response.json({ 
      error: 'Failed to analyze',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

