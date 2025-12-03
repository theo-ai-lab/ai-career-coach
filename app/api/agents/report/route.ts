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

interface JobMatching {
  matchScore: number;
  strongMatches: string[];
  gaps: string[];
  keywordsToAdd: string[];
  talkingPoints: string[];
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

You are analyzing a resume that has already been chunked and retrieved via RAG.

CONTEXT FROM RESUME (retrieved_chunks):
${resumeContext}

CRITICAL GROUNDING RULES:
- You MUST base every part of your analysis on specific details from the context above.
- Before stating that a skill, tool, domain, or experience is missing, SEARCH the entire context for related keywords, abbreviations, and synonyms.
- Never claim a skill or area (e.g., AI ethics, responsible AI, experimentation) is missing if it appears anywhere in the context, including via an AI minor or course names.
- If the context is insufficient for a section, explicitly use "insufficient data" instead of inventing content.

SPECIFICITY REQUIREMENTS:
- Extract and reference concrete metrics, numbers, timeframes, and project scopes where available.
- Reference actual company names, project names, course titles, and tools as they appear in the context.
- Do NOT use vague phrases like "various projects" or "multiple initiatives"—always use actual names when present.

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "summary": "A 2-3 sentence summary of the candidate's background and experience",
  "keyStrengths": ["strength 1", "strength 2", "strength 3"],
  "notableProjects": ["project 1", "project 2", "project 3"],
  "coreSkills": ["skill 1", "skill 2", "skill 3"]
}

Additional formatting constraints:
- Return ONLY valid JSON, no markdown formatting or additional text.
- Do not wrap the JSON in code fences.
- When data is unclear or missing, use "insufficient data" or an empty array instead of hallucinating.`;

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

    // Step 3: Job matching (optional – only if jobDescription provided)
    let jobMatching: JobMatching | null = null;
    if (jobDescription && jobDescription.trim()) {
      console.log('Report pipeline: starting jobMatching');
      const jobMatchingPrompt = `You are a job matching specialist. You will be given:

RESUME CONTEXT:
${resumeContext}

JOB DESCRIPTION:
${jobDescription}

CRITICAL GROUNDING RULES:
- ONLY use information from the provided RESUME CONTEXT. Do not invent or assume any experience that is not clearly supported there.
- When you claim a "strong match", you must be able to point to specific evidence from the resume context (e.g., projects, roles, achievements).
- When you list a "gap", it should be something that is clearly requested or implied by the JOB DESCRIPTION and not present in the resume context.
- If the job description is vague or missing details in some areas, mark those as "insufficient data" instead of guessing.

COMPARISON INSTRUCTIONS:
- Carefully read the JOB DESCRIPTION and extract the concrete requirements, responsibilities, and preferred qualifications.
- For each major requirement, search the RESUME CONTEXT for explicit or closely related evidence.
- Be specific about tools, technologies, domains, and years of experience when possible.

OUTPUT FORMAT:
Return a single JSON object with this exact shape:
{
  "matchScore": 0-100,
  "strongMatches": ["specific requirement that is strongly matched", "..."],
  "gaps": ["specific requirement that is missing or weakly supported", "..."],
  "keywordsToAdd": ["keyword or phrase that appears in the job description but not clearly in the resume", "..."],
  "talkingPoints": ["concrete talking point mapping their past experience to this role", "..."]
}

Additional formatting rules:
- Return ONLY valid JSON, no markdown or explanation outside the JSON.
- Do NOT wrap the JSON in code fences.
- If something is unclear from the resume, prefer "insufficient data" over hallucinating.`;

      const jobMatchingResponse = await llm.invoke(jobMatchingPrompt);
      try {
        const content = jobMatchingResponse.content.toString();
        jobMatching = parseJsonResponse(content, 'job matching') as JobMatching;
      } catch (parseError: any) {
        console.error('Failed to parse jobMatching:', parseError);
        return new Response(parseError.message || 'Failed to parse job matching from model response.', { status: 500 });
      }
      console.log('Report pipeline: jobMatching done');
    } else {
      console.log('Report pipeline: skipping jobMatching (no jobDescription provided)');
    }

    // Step 4: Gap analysis vs target role
    console.log('Report pipeline: starting gapAnalysis');
    const jobDesc = jobDescription || `APM role at ${targetCompany} working on AI-native product experiences.`;
    const gapAnalysisPrompt = `You are an AI career coach analyzing fit between a candidate and ${targetRole} role at ${targetCompany}.

You are given:
- Candidate Resume Analysis (grounded in RAG):
${JSON.stringify(resumeAnalysis, null, 2)}
- Target Role: ${targetRole} at ${targetCompany}
- Job Description: ${jobDesc}

CRITICAL GROUNDING RULES:
- Treat the resumeAnalysis as the authoritative summary of the candidate's background.
- Before listing any "missingTechnicalSkills", "missingProductSkills", or "experienceGaps", SEARCH the resumeAnalysis for related keywords and synonyms.
- Never state that a skill, domain, or experience is missing if it appears anywhere in the resumeAnalysis (for example, do NOT say "AI ethics" is missing if there is an AI minor or relevant coursework).
- If you are unsure whether something is actually missing, mark it as "insufficient data" rather than guessing.

SPECIFICITY REQUIREMENTS:
- When describing gaps and recommendations, reference specific projects, tools, or experiences from the resumeAnalysis.
- Avoid generic phrases like "various projects"; use concrete names where possible.
- If the candidate already has experience in an area, do NOT suggest "gaining experience" there. Instead, suggest deepening or broadening that experience.

OUTPUT FORMAT:
Analyze the gaps and provide a structured JSON response:
{
  "roleFitScore": 0-100,
  "missingTechnicalSkills": ["skill 1", "skill 2"],
  "missingProductSkills": ["skill 1", "skill 2"],
  "experienceGaps": ["gap 1", "gap 2"],
  "recommendations": ["recommendation 1", "recommendation 2"]
}

Additional formatting constraints:
- Return ONLY valid JSON, no markdown formatting or additional text.
- Do not wrap the JSON in code fences.
- Use "insufficient data" when the job description or resume analysis does not clearly support a detailed statement.`;

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

    // Step 5: Cover letter generation
    console.log('Report pipeline: starting coverLetter');
    const coverLetterPrompt = `You are an AI career coach helping a candidate write a tailored cover letter.

You are given:
- Candidate Summary: ${resumeAnalysis.summary}
- Key Strengths: ${resumeAnalysis.keyStrengths.join(', ')}
- Recommendations from gap analysis: ${gapAnalysis.recommendations.join(', ')}
- Target Company: ${targetCompany}
- Target Role: ${targetRole}

CRITICAL GROUNDING RULES:
- Ground every sentence of the cover letter in the resume analysis and gap analysis above.
- Before implying that a skill or domain is missing, SEARCH the resumeAnalysis summary and keyStrengths for related terms; never say something is missing if it appears there.
- Do not invent new companies, roles, or projects not implied by the analysis.

SPECIFICITY REQUIREMENTS:
- Reference actual projects, tools, and metrics mentioned in the resumeAnalysis (e.g., named RAG systems, LangGraph agents, product metrics).
- Avoid generic phrases like "various projects" or "multiple initiatives"; always use the specific project or experience names when available.
- If the candidate already has experience in an area, do not suggest they need to "gain experience" in that area; instead, frame it as a strength.

OUTPUT FORMAT:
- Write a professional, tailored cover letter in markdown format that:
  - Is addressed to ${targetCompany}.
  - Is specifically tailored to the ${targetRole} role.
  - Explicitly uses the candidate's background from the resume analysis with concrete examples.
  - Highlights relevant strengths and addresses how the candidate can contribute.
- Optionally end with a short line indicating your confidence in the fit (e.g., "Confidence: high/medium/low") based on how well the analysis aligns with the job.

Return ONLY the markdown cover letter text (no JSON wrapper).`;

    const coverLetterResponse = await llm.invoke(coverLetterPrompt);
    const coverLetterMarkdown: string = coverLetterResponse.content.toString();
    console.log('Report pipeline: coverLetter done');

    // Step 6: Interview prep generation
    console.log('Report pipeline: starting interviewPrep');
    const interviewPrepPrompt = `You are an AI career coach preparing a candidate for interviews at ${targetCompany} for ${targetRole}.

You are given:
- Resume Analysis (grounded in RAG):
${JSON.stringify(resumeAnalysis, null, 2)}
- Gap Analysis:
${JSON.stringify(gapAnalysis, null, 2)}
- Target Company: ${targetCompany}
- Target Role: ${targetRole}

CRITICAL GROUNDING RULES:
- All interview questions and answers must be based on the resumeAnalysis and gapAnalysis above.
- Before labeling something as a weakness or gap, SEARCH the resumeAnalysis for related experience and avoid calling it missing if it is already present.
- If the context does not contain enough information to construct a realistic example, respond with "insufficient data" for that part instead of fabricating details.

SPECIFICITY REQUIREMENTS:
- Behavioral and product answers must follow STAR and reference concrete projects, company names, metrics, and tools from the resumeAnalysis.
- Technical answers should reference real systems and tools used by the candidate (e.g., specific RAG systems, LangGraph agents, Next.js apps) when appropriate.
- Avoid generic placeholders like "various projects"; use actual project names instead.

OUTPUT FORMAT:
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

Additional requirements:
- Include 3–4 questions per category.
- Answers should be tightly tailored to the candidate's actual background.
- Return ONLY valid JSON, no markdown formatting or additional text.`;

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

    // Step 7: 6-month strategy plan
    console.log('Report pipeline: starting strategyPlan');
    const strategyPrompt = `You are an AI career coach creating a 6-month strategy plan.

You are given:
- Gap Analysis:
${JSON.stringify(gapAnalysis, null, 2)}
- Target Company: ${targetCompany}
- Target Role: ${targetRole}

CRITICAL GROUNDING RULES:
- Base the strategy entirely on the true gaps identified in gapAnalysis; do not invent new missing skills or experiences.
- Before recommending that the candidate "gain experience" in an area, verify that the gapAnalysis genuinely treats it as a gap and that resumeAnalysis (implicitly) does not already cover it.
- If information is lacking to make a precise recommendation, mark it as "insufficient data" instead of guessing.

SPECIFICITY REQUIREMENTS:
- Propose concrete, time-bounded actions (e.g., "Ship <project> v1 by end of Month 2", "Complete <named course>").
- Avoid generic statements like "work on side projects"; tie actions back to specific skill gaps and, when possible, existing projects.

OUTPUT FORMAT:
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

Additional formatting constraints:
- Return ONLY valid JSON, no markdown formatting or additional text.
- Do not wrap the JSON in code fences.
- Ensure the plan accounts for the candidate's existing strengths and does not ask them to start from zero in areas where they already have experience.`;

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

    // Step 8: Compile final career report markdown
    console.log('Report pipeline: compiling final report');
    const jobMatchingSection = jobMatching
      ? `
## 3. Job Match vs. Provided Description

**Overall Match Score:** ${jobMatching.matchScore}/100

### Strong Matches

${jobMatching.strongMatches.map(m => `- ${m}`).join('\n')}

### Key Gaps

${jobMatching.gaps.map(g => `- ${g}`).join('\n')}

### Keywords to Add

${jobMatching.keywordsToAdd.map(k => `- ${k}`).join('\n')}

### Talking Points for Interviews

${jobMatching.talkingPoints.map(t => `- ${t}`).join('\n')}
`
      : '';

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

${jobMatchingSection}

## ${jobMatching ? '4' : '3'}. Tailored Cover Letter

${coverLetterMarkdown}

## ${jobMatching ? '5' : '4'}. Interview Prep

### Behavioral Questions

${interviewPrep.behavioral.map(qa => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Product Questions

${interviewPrep.product.map(qa => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Technical Questions

${interviewPrep.technical.map(qa => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Interview Strategy Summary

${interviewPrep.metaSummary}

## ${jobMatching ? '6' : '5'}. 6-Month Strategy Plan

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
