import { NextRequest } from 'next/server';
import { getResumeContextById, getChatClient } from '@/lib/rag';

interface RequestBody {
  resumeId: string;
  targetCompany?: string;
  targetRole?: string;
  jobDescription?: string;
}

interface ResumeAnalysis {
  summary: string;
  keyStrengths: string[];
  notableProjects: string[];
  coreSkills: string[];
}

interface GapAnalysis {
  roleFitScore: number;
  missingTechnicalSkills: string[];
  missingProductSkills: string[];
  experienceGaps: string[];
  recommendations: string[];
}

interface InterviewPrep {
  behavioral: Array<{ question: string; answer: string }>;
  product: Array<{ question: string; answer: string }>;
  technical: Array<{ question: string; answer: string }>;
  metaSummary: string;
}

interface StrategyPlan {
  sixMonthGoal: string;
  monthlyBreakdown: Array<{ month: number; focus: string; actions: string[] }>;
  finalRecommendation: string;
}

/**
 * Helper function to safely parse JSON from LLM responses
 * Strips code fences and extracts JSON object
 */
function parseJsonResponse(content: string, stepName: string): any {
  try {
    // Remove markdown code blocks if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    
    // Try to extract JSON object from content
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in response`);
    }
    
    const jsonStr = jsonMatch[0];
    return JSON.parse(jsonStr);
  } catch (error: any) {
    throw new Error(`Failed to parse ${stepName} from model response: ${error.message}`);
  }
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

    console.log('Report pipeline: starting for resumeId', resumeId);

    // Step 1: Retrieve resume context (RAG)
    let chunks: string[];
    try {
      const result = await getResumeContextById(resumeId, 12);
      chunks = result.chunks;
    } catch (error: any) {
      if (error.message?.includes('No documents found for resumeId')) {
        return new Response('No resume chunks found for the provided resumeId. Please upload a resume again.', { status: 400 });
      }
      throw error; // Re-throw other errors
    }
    
    const resumeContext = chunks.join('\n\n');
    console.log('Report pipeline: retrieved', chunks.length, 'chunks');

    const llm = getChatClient();

    // Step 2: Resume analysis
    console.log('Report pipeline: starting resumeAnalysis');
    const resumeAnalysisPrompt = `You are an AI career coach for a candidate applying to ${targetCompany} ${targetRole}.

Analyze the following resume content and provide a structured JSON analysis:

${resumeContext}

Return a JSON object with this exact structure:
{
  "summary": "A 2-3 sentence summary of the candidate's background and experience",
  "keyStrengths": ["strength 1", "strength 2", "strength 3"],
  "notableProjects": ["project 1", "project 2", "project 3"],
  "coreSkills": ["skill 1", "skill 2", "skill 3"]
}

Return ONLY valid JSON, no markdown formatting or additional text.`;

    const resumeAnalysisResponse = await llm.invoke(resumeAnalysisPrompt);
    let resumeAnalysis: ResumeAnalysis;
    try {
      const content = resumeAnalysisResponse.content.toString();
      resumeAnalysis = parseJsonResponse(content, 'resume analysis');
      if (!resumeAnalysis.summary) {
        throw new Error('Missing summary in resumeAnalysis');
      }
    } catch (parseError: any) {
      console.error('Failed to parse resumeAnalysis:', parseError);
      return new Response(parseError.message || 'Failed to parse resume analysis from model response.', { status: 500 });
    }
    console.log('Report pipeline: resumeAnalysis done');

    // Step 3: Gap analysis vs target role
    console.log('Report pipeline: starting gapAnalysis');
    const jobDesc = jobDescription || `APM role at ${targetCompany} working on AI-native product experiences.`;
    const gapAnalysisPrompt = `You are an AI career coach analyzing fit between a candidate and ${targetRole} role at ${targetCompany}.

Candidate Resume Analysis:
${JSON.stringify(resumeAnalysis, null, 2)}

Target Role: ${targetRole} at ${targetCompany}
Job Description: ${jobDesc}

Analyze the gaps and provide a structured JSON response:
{
  "roleFitScore": 0-100,
  "missingTechnicalSkills": ["skill 1", "skill 2"],
  "missingProductSkills": ["skill 1", "skill 2"],
  "experienceGaps": ["gap 1", "gap 2"],
  "recommendations": ["recommendation 1", "recommendation 2"]
}

Return ONLY valid JSON, no markdown formatting or additional text.`;

    const gapAnalysisResponse = await llm.invoke(gapAnalysisPrompt);
    let gapAnalysis: GapAnalysis;
    try {
      const content = gapAnalysisResponse.content.toString();
      gapAnalysis = parseJsonResponse(content, 'gap analysis');
    } catch (parseError: any) {
      console.error('Failed to parse gapAnalysis:', parseError);
      return new Response(parseError.message || 'Failed to parse gap analysis from model response.', { status: 500 });
    }
    console.log('Report pipeline: gapAnalysis done');

    // Step 4: Cover letter generation
    console.log('Report pipeline: starting coverLetter');
    const coverLetterPrompt = `You are an AI career coach helping a candidate write a tailored cover letter.

Candidate Summary: ${resumeAnalysis.summary}
Key Strengths: ${resumeAnalysis.keyStrengths.join(', ')}
Recommendations: ${gapAnalysis.recommendations.join(', ')}
Target Company: ${targetCompany}
Target Role: ${targetRole}

Write a professional, tailored cover letter in markdown format that:
- Is addressed to ${targetCompany}
- Is specifically tailored to the ${targetRole} role
- Explicitly uses the candidate's background from the resume analysis
- Highlights relevant strengths and addresses how the candidate can contribute

Return the cover letter as markdown text (no JSON wrapper).`;

    const coverLetterResponse = await llm.invoke(coverLetterPrompt);
    const coverLetterMarkdown: string = coverLetterResponse.content.toString();
    console.log('Report pipeline: coverLetter done');

    // Step 5: Interview prep generation
    console.log('Report pipeline: starting interviewPrep');
    const interviewPrepPrompt = `You are an AI career coach preparing a candidate for interviews at ${targetCompany} for ${targetRole}.

Resume Analysis:
${JSON.stringify(resumeAnalysis, null, 2)}

Gap Analysis:
${JSON.stringify(gapAnalysis, null, 2)}

Target Company: ${targetCompany}
Target Role: ${targetRole}

Generate interview preparation questions and answers. Return a JSON object:
{
  "behavioral": [
    { "question": "...", "answer": "..." }
  ],
  "product": [
    { "question": "...", "answer": "..." }
  ],
  "technical": [
    { "question": "...", "answer": "..." }
  ],
  "metaSummary": "Overall interview strategy summary"
}

Include 3-4 questions per category. Answers should be tailored to the candidate's actual background.

Return ONLY valid JSON, no markdown formatting or additional text.`;

    const interviewPrepResponse = await llm.invoke(interviewPrepPrompt);
    let interviewPrep: InterviewPrep;
    try {
      const content = interviewPrepResponse.content.toString();
      interviewPrep = parseJsonResponse(content, 'interview prep');
    } catch (parseError: any) {
      console.error('Failed to parse interviewPrep:', parseError);
      return new Response(parseError.message || 'Failed to parse interview prep from model response.', { status: 500 });
    }
    console.log('Report pipeline: interviewPrep done');

    // Step 6: 6-month strategy plan
    console.log('Report pipeline: starting strategyPlan');
    const strategyPrompt = `You are an AI career coach creating a 6-month strategy plan.

Gap Analysis:
${JSON.stringify(gapAnalysis, null, 2)}

Target Company: ${targetCompany}
Target Role: ${targetRole}

Create a detailed 6-month strategy plan. Return a JSON object:
{
  "sixMonthGoal": "Clear goal statement",
  "monthlyBreakdown": [
    { "month": 1, "focus": "Focus area for month 1", "actions": ["action 1", "action 2"] },
    { "month": 2, "focus": "Focus area for month 2", "actions": ["action 1", "action 2"] },
    { "month": 3, "focus": "Focus area for month 3", "actions": ["action 1", "action 2"] },
    { "month": 4, "focus": "Focus area for month 4", "actions": ["action 1", "action 2"] },
    { "month": 5, "focus": "Focus area for month 5", "actions": ["action 1", "action 2"] },
    { "month": 6, "focus": "Focus area for month 6", "actions": ["action 1", "action 2"] }
  ],
  "finalRecommendation": "Final recommendation summary"
}

Return ONLY valid JSON, no markdown formatting or additional text.`;

    const strategyResponse = await llm.invoke(strategyPrompt);
    let strategyPlan: StrategyPlan;
    try {
      const content = strategyResponse.content.toString();
      strategyPlan = parseJsonResponse(content, 'strategy plan');
    } catch (parseError: any) {
      console.error('Failed to parse strategyPlan:', parseError);
      return new Response(parseError.message || 'Failed to parse strategy plan from model response.', { status: 500 });
    }
    console.log('Report pipeline: strategyPlan done');

    // Step 7: Compile final career report markdown
    console.log('Report pipeline: compiling final report');
    const reportMarkdown = `# AI Career Report → ${targetCompany} ${targetRole}

## 1. Resume Summary

${resumeAnalysis.summary}

### Key Strengths

${resumeAnalysis.keyStrengths.map(s => `- ${s}`).join('\n')}

### Notable Projects

${resumeAnalysis.notableProjects.map(p => `- ${p}`).join('\n')}

### Core Skills

${resumeAnalysis.coreSkills.map(s => `- ${s}`).join('\n')}

## 2. Fit vs. ${targetCompany} ${targetRole}

**Role Fit Score:** ${gapAnalysis.roleFitScore}/100

### Missing Technical Skills

${gapAnalysis.missingTechnicalSkills.map(s => `- ${s}`).join('\n')}

### Missing Product Skills

${gapAnalysis.missingProductSkills.map(s => `- ${s}`).join('\n')}

### Experience Gaps

${gapAnalysis.experienceGaps.map(g => `- ${g}`).join('\n')}

### Recommendations

${gapAnalysis.recommendations.map(r => `- ${r}`).join('\n')}

## 3. Tailored Cover Letter

${coverLetterMarkdown}

## 4. Interview Prep

### Behavioral Questions

${interviewPrep.behavioral.map(qa => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Product Questions

${interviewPrep.product.map(qa => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Technical Questions

${interviewPrep.technical.map(qa => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Interview Strategy Summary

${interviewPrep.metaSummary}

## 5. 6-Month Strategy Plan

### Goal

${strategyPlan.sixMonthGoal}

### Monthly Breakdown

${strategyPlan.monthlyBreakdown.map(m => `#### Month ${m.month}: ${m.focus}\n\n${m.actions.map(a => `- ${a}`).join('\n')}`).join('\n\n')}

### Final Recommendation

${strategyPlan.finalRecommendation}

---

*Report generated using AI Career Coach - Grounded in your actual resume via RAG*`;

    console.log('Report pipeline: final report compiled');

    return new Response(reportMarkdown, {
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
 * REPORT PIPELINE SUMMARY
 * 
 * Data Flow:
 * 1. Client sends: { resumeId, targetCompany?, targetRole?, jobDescription? }
 * 2. Server retrieves resume chunks via RAG (getResumeContextById)
 * 3. Server runs 5 sequential LLM calls:
 *    - Resume Analysis (JSON)
 *    - Gap Analysis (JSON)
 *    - Cover Letter (Markdown)
 *    - Interview Prep (JSON)
 *    - Strategy Plan (JSON)
 * 4. Server compiles all outputs into a single markdown report
 * 5. Client receives markdown and downloads as .md file
 * 
 * LLM Calls: 5 total (all using gpt-4o-mini, temperature 0.2)
 * 
 * The report content will clearly change based on:
 * - Different resumeId → different RAG chunks → different analysis
 * - Different targetCompany/targetRole → different gap analysis and tailored content
 * 
 * Server logs show each step: resumeAnalysis, gapAnalysis, coverLetter, interviewPrep, strategyPlan
 */
