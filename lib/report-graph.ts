/**
 * LangGraph Orchestration for Career Report Generation
 * 
 * This graph orchestrates the multi-step process of generating a comprehensive career report:
 * 
 * WORKFLOW:
 * 1. START → fetchResumeContext: Retrieve resume context via RAG
 * 2. analyzeResume: Analyze resume (with evaluation)
 * 3. analyzeGaps: Perform gap analysis (with evaluation)
 * 4. CONDITIONAL: If jobDescription provided → matchJob, else skip
 * 5. writeCoverLetter: Generate cover letter (with evaluation)
 * 6. PARALLEL: prepInterview + planStrategy (both with evaluation)
 * 7. buildReport: Compile final markdown report
 * 8. END → Return report
 * 
 * FEATURES:
 * - Conditional routing: Job matching only runs if jobDescription is provided
 * - Parallel execution: Interview prep and strategy plan run simultaneously after gap analysis
 * - State management: All data flows through graph state
 * - Evaluation: Quality scoring at each step
 * - Error handling: Graceful failures with detailed error messages
 */

import { StateGraph, END } from '@langchain/langgraph';
import { getResumeContextById, getChatClient } from '@/lib/rag';
import { evaluateCoachingQuality } from '@/lib/evals/coaching-quality';
import { getSupabase } from '@/lib/supabase';

/**
 * State interface for the report generation graph
 */
interface ReportState {
  // Inputs
  resumeId: string;
  targetCompany: string;
  targetRole: string;
  jobDescription?: string;
  
  // Intermediate data
  resumeContext?: string[];
  resumeAnalysis?: any;
  gapAnalysis?: any;
  jobMatching?: any;
  coverLetter?: string;
  interviewPrep?: any;
  strategyPlan?: any;
  
  // Evaluation results
  resumeAnalysisEval?: any;
  gapAnalysisEval?: any;
  coverLetterEval?: any;
  interviewPrepEval?: any;
  strategyPlanEval?: any;
  
  // Final output
  reportMarkdown?: string;
  
  // Error tracking
  error?: string;
}

/**
 * Helper to safely parse JSON from LLM responses
 */
function parseJsonResponse(content: string, stepName: string): any {
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in response`);
    }
    
    return JSON.parse(jsonMatch[0]);
  } catch (error: any) {
    throw new Error(`Failed to parse ${stepName} from model response: ${error.message}`);
  }
}

/**
 * Helper to evaluate a coaching response
 */
async function evaluateResponse(
  sectionName: string,
  query: string,
  response: string,
  contexts: string[],
  responseId: string
): Promise<any | null> {
  try {
    const evalResult = await evaluateCoachingQuality({
      query,
      response,
      contexts,
    });

    // Store in Supabase (non-blocking)
    try {
      const supabase = getSupabase();
      await supabase.from('evals').insert({
        response_id: `${responseId}-${sectionName}`,
        query,
        response,
        contexts,
        scores: evalResult.scores,
        reasoning: evalResult.reasoning,
        overall_score: evalResult.overall,
      });
    } catch (dbError: any) {
      console.error(`Failed to store eval for ${sectionName}:`, dbError.message);
    }

    return evalResult;
  } catch (error: any) {
    console.error(`Eval error for ${sectionName}:`, error.message);
    return null;
  }
}

/**
 * Node 1: Retrieve resume context via RAG
 */
async function resumeContextNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: retrieving resume context for', state.resumeId);
    const result = await getResumeContextById(state.resumeId, 12);
    const resumeContext = result.chunks.join('\n\n');
    console.log('Report graph: retrieved', result.chunks.length, 'chunks');
    return { resumeContext: result.chunks };
  } catch (error: any) {
    if (error.message?.includes('No documents found for resumeId')) {
      throw new Error('No resume chunks found for the provided resumeId. Please upload a resume again.');
    }
    throw error;
  }
}

/**
 * Node 2: Analyze resume
 */
async function resumeAnalysisNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: starting resumeAnalysis');
    const llm = getChatClient();
    const resumeContext = state.resumeContext!.join('\n\n');
    
    const prompt = `You are an AI career coach for a candidate applying to ${state.targetCompany} ${state.targetRole}.

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

    const response = await llm.invoke(prompt);
    const resumeAnalysis = parseJsonResponse(response.content.toString(), 'resume analysis');
    
    if (!resumeAnalysis.summary) {
      throw new Error('Missing summary in resumeAnalysis');
    }
    
    // Evaluate
    const resumeAnalysisEval = await evaluateResponse(
      'resumeAnalysis',
      `Analyze my resume and provide a summary of my background, strengths, projects, and core skills.`,
      JSON.stringify(resumeAnalysis, null, 2),
      state.resumeContext!,
      state.resumeId
    );
    
    console.log('Report graph: resumeAnalysis done');
    return { resumeAnalysis, resumeAnalysisEval };
  } catch (error: any) {
    throw new Error(`Resume analysis failed: ${error.message}`);
  }
}

/**
 * Node 3: Gap analysis
 */
async function gapAnalysisNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: starting gapAnalysis');
    const llm = getChatClient();
    const jobDesc = state.jobDescription || `APM role at ${state.targetCompany} working on AI-native product experiences.`;
    
    const prompt = `You are an AI career coach analyzing fit between a candidate and ${state.targetRole} role at ${state.targetCompany}.

You are given:
- Candidate Resume Analysis (grounded in RAG):
${JSON.stringify(state.resumeAnalysis, null, 2)}
- Target Role: ${state.targetRole} at ${state.targetCompany}
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

    const response = await llm.invoke(prompt);
    const gapAnalysis = parseJsonResponse(response.content.toString(), 'gap analysis');
    
    // Evaluate
    const gapAnalysisEval = await evaluateResponse(
      'gapAnalysis',
      `Analyze the fit between my background and the ${state.targetRole} role at ${state.targetCompany}. Identify gaps and provide recommendations.`,
      JSON.stringify(gapAnalysis, null, 2),
      state.resumeContext!,
      state.resumeId
    );
    
    console.log('Report graph: gapAnalysis done');
    return { gapAnalysis, gapAnalysisEval };
  } catch (error: any) {
    throw new Error(`Gap analysis failed: ${error.message}`);
  }
}

/**
 * Node 4: Job matching (conditional - only if jobDescription provided)
 */
async function jobMatchingNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: starting jobMatching');
    const llm = getChatClient();
    const resumeContext = state.resumeContext!.join('\n\n');
    
    const prompt = `You are a job matching specialist. You will be given:

RESUME CONTEXT:
${resumeContext}

JOB DESCRIPTION:
${state.jobDescription}

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

    const response = await llm.invoke(prompt);
    const jobMatching = parseJsonResponse(response.content.toString(), 'job matching');
    
    console.log('Report graph: jobMatching done');
    return { jobMatching };
  } catch (error: any) {
    throw new Error(`Job matching failed: ${error.message}`);
  }
}

/**
 * Node 5: Cover letter generation
 */
async function coverLetterNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: starting coverLetter');
    const llm = getChatClient();
    
    const prompt = `You are an AI career coach helping a candidate write a tailored cover letter.

You are given:
- Candidate Summary: ${state.resumeAnalysis!.summary}
- Key Strengths: ${state.resumeAnalysis!.keyStrengths.join(', ')}
- Recommendations from gap analysis: ${state.gapAnalysis!.recommendations.join(', ')}
- Target Company: ${state.targetCompany}
- Target Role: ${state.targetRole}

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
  - Is addressed to ${state.targetCompany}.
  - Is specifically tailored to the ${state.targetRole} role.
  - Explicitly uses the candidate's background from the resume analysis with concrete examples.
  - Highlights relevant strengths and addresses how the candidate can contribute.
- Optionally end with a short line indicating your confidence in the fit (e.g., "Confidence: high/medium/low") based on how well the analysis aligns with the job.

Return ONLY the markdown cover letter text (no JSON wrapper).`;

    const response = await llm.invoke(prompt);
    const coverLetter = response.content.toString();
    
    // Evaluate
    const coverLetterEval = await evaluateResponse(
      'coverLetter',
      `Write a tailored cover letter for the ${state.targetRole} role at ${state.targetCompany}.`,
      coverLetter,
      state.resumeContext!,
      state.resumeId
    );
    
    console.log('Report graph: coverLetter done');
    return { coverLetter, coverLetterEval };
  } catch (error: any) {
    throw new Error(`Cover letter generation failed: ${error.message}`);
  }
}

/**
 * Node 6a: Interview prep generation (runs in parallel with strategy plan)
 */
async function interviewPrepNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: starting interviewPrep');
    const llm = getChatClient();
    
    const prompt = `You are an AI career coach preparing a candidate for interviews at ${state.targetCompany} for ${state.targetRole}.

You are given:
- Resume Analysis (grounded in RAG):
${JSON.stringify(state.resumeAnalysis, null, 2)}
- Gap Analysis:
${JSON.stringify(state.gapAnalysis, null, 2)}
- Target Company: ${state.targetCompany}
- Target Role: ${state.targetRole}

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

    const response = await llm.invoke(prompt);
    const interviewPrep = parseJsonResponse(response.content.toString(), 'interview prep');
    
    // Evaluate
    const interviewPrepEval = await evaluateResponse(
      'interviewPrep',
      `Prepare me for interviews at ${state.targetCompany} for the ${state.targetRole} role. Generate behavioral, product, and technical questions with answers.`,
      JSON.stringify(interviewPrep, null, 2),
      state.resumeContext!,
      state.resumeId
    );
    
    console.log('Report graph: interviewPrep done');
    return { interviewPrep, interviewPrepEval };
  } catch (error: any) {
    throw new Error(`Interview prep generation failed: ${error.message}`);
  }
}

/**
 * Node 6b: Strategy plan generation (runs in parallel with interview prep)
 */
async function strategyPlanNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: starting strategyPlan');
    const llm = getChatClient();
    
    const prompt = `You are an AI career coach creating a 6-month strategy plan.

You are given:
- Gap Analysis:
${JSON.stringify(state.gapAnalysis, null, 2)}
- Target Company: ${state.targetCompany}
- Target Role: ${state.targetRole}

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

    const response = await llm.invoke(prompt);
    const strategyPlan = parseJsonResponse(response.content.toString(), 'strategy plan');
    
    // Evaluate
    const strategyPlanEval = await evaluateResponse(
      'strategyPlan',
      `Create a 6-month strategy plan to help me land the ${state.targetRole} role at ${state.targetCompany}.`,
      JSON.stringify(strategyPlan, null, 2),
      state.resumeContext!,
      state.resumeId
    );
    
    console.log('Report graph: strategyPlan done');
    return { strategyPlan, strategyPlanEval };
  } catch (error: any) {
    throw new Error(`Strategy plan generation failed: ${error.message}`);
  }
}

/**
 * Node 7: Compile final markdown report
 */
async function compileReportNode(state: ReportState): Promise<Partial<ReportState>> {
  try {
    console.log('Report graph: compiling final report');
    
    const formatConfidence = (evalResult: any, sectionName: string): string => {
      if (!evalResult) return '';
      const score = evalResult.overall;
      const emoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
      return `\n\n*${emoji} Quality Score: ${score}/100 (${sectionName})*`;
    };
    
    const jobMatchingSection = state.jobMatching
      ? `
## 3. Job Match vs. Provided Description

**Overall Match Score:** ${state.jobMatching.matchScore}/100

### Strong Matches

${state.jobMatching.strongMatches.map((m: string) => `- ${m}`).join('\n')}

### Key Gaps

${state.jobMatching.gaps.map((g: string) => `- ${g}`).join('\n')}

### Keywords to Add

${state.jobMatching.keywordsToAdd.map((k: string) => `- ${k}`).join('\n')}

### Talking Points for Interviews

${state.jobMatching.talkingPoints.map((t: string) => `- ${t}`).join('\n')}
`
      : '';

    const reportMarkdown = `# AI Career Report → ${state.targetCompany} ${state.targetRole}

> **⚠️ Important Disclaimer:** This report is AI-generated guidance. For major career decisions, consider consulting with a professional career coach.

## 1. Resume Summary

${state.resumeAnalysis!.summary}${formatConfidence(state.resumeAnalysisEval, 'Resume Analysis')}

### Key Strengths

${state.resumeAnalysis!.keyStrengths.map((s: string) => `- ${s}`).join('\n')}

### Notable Projects

${state.resumeAnalysis!.notableProjects.map((p: string) => `- ${p}`).join('\n')}

### Core Skills

${state.resumeAnalysis!.coreSkills.map((s: string) => `- ${s}`).join('\n')}

## 2. Fit vs. ${state.targetCompany} ${state.targetRole}

**Role Fit Score:** ${state.gapAnalysis!.roleFitScore}/100

### Missing Technical Skills

${state.gapAnalysis!.missingTechnicalSkills.map((s: string) => `- ${s}`).join('\n')}

### Missing Product Skills

${state.gapAnalysis!.missingProductSkills.map((s: string) => `- ${s}`).join('\n')}

### Experience Gaps

${state.gapAnalysis!.experienceGaps.map((g: string) => `- ${g}`).join('\n')}

### Recommendations

${state.gapAnalysis!.recommendations.map((r: string) => `- ${r}`).join('\n')}${formatConfidence(state.gapAnalysisEval, 'Gap Analysis')}

${jobMatchingSection}

## ${state.jobMatching ? '4' : '3'}. Tailored Cover Letter

${state.coverLetter!}${formatConfidence(state.coverLetterEval, 'Cover Letter')}

## ${state.jobMatching ? '5' : '4'}. Interview Prep

### Behavioral Questions

${state.interviewPrep!.behavioral.map((qa: any) => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Product Questions

${state.interviewPrep!.product.map((qa: any) => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Technical Questions

${state.interviewPrep!.technical.map((qa: any) => `**Q:** ${qa.question}\n\n**A:** ${qa.answer}\n`).join('\n')}

### Interview Strategy Summary

${state.interviewPrep!.metaSummary}${formatConfidence(state.interviewPrepEval, 'Interview Prep')}

## ${state.jobMatching ? '6' : '5'}. 6-Month Strategy Plan

### Goal

${state.strategyPlan!.sixMonthGoal}

### Monthly Breakdown

${state.strategyPlan!.monthlyBreakdown.map((m: any) => `#### Month ${m.month}: ${m.focus}\n\n${m.actions.map((a: string) => `- ${a}`).join('\n')}`).join('\n\n')}

### Final Recommendation

${state.strategyPlan!.finalRecommendation}${formatConfidence(state.strategyPlanEval, 'Strategy Plan')}

---

*Report generated using AI Career Coach - Grounded in your actual resume via RAG*

## Quality Metrics

${[
  state.resumeAnalysisEval && `**Resume Analysis:** ${state.resumeAnalysisEval.overall}/100`,
  state.gapAnalysisEval && `**Gap Analysis:** ${state.gapAnalysisEval.overall}/100`,
  state.coverLetterEval && `**Cover Letter:** ${state.coverLetterEval.overall}/100`,
  state.interviewPrepEval && `**Interview Prep:** ${state.interviewPrepEval.overall}/100`,
  state.strategyPlanEval && `**Strategy Plan:** ${state.strategyPlanEval.overall}/100`,
].filter(Boolean).join('\n')}

*View detailed evaluations at /admin/evals*`;

    console.log('Report graph: final report compiled');
    return { reportMarkdown };
  } catch (error: any) {
    throw new Error(`Report compilation failed: ${error.message}`);
  }
}

/**
 * Conditional routing function: should we run job matching?
 */
function shouldRunJobMatching(state: ReportState): string {
  return state.jobDescription && state.jobDescription.trim() ? 'matchJob' : 'writeCoverLetter';
}

/**
 * Build and compile the graph
 */
const graph = new StateGraph<ReportState>({
  channels: {
    resumeId: null,
    targetCompany: null,
    targetRole: null,
    jobDescription: null,
    resumeContext: null,
    resumeAnalysis: null,
    gapAnalysis: null,
    jobMatching: null,
    coverLetter: null,
    interviewPrep: null,
    strategyPlan: null,
    resumeAnalysisEval: null,
    gapAnalysisEval: null,
    coverLetterEval: null,
    interviewPrepEval: null,
    strategyPlanEval: null,
    reportMarkdown: null,
    error: null,
  },
});

// Add nodes
graph.addNode('fetchResumeContext', resumeContextNode);
graph.addNode('analyzeResume', resumeAnalysisNode);
graph.addNode('analyzeGaps', gapAnalysisNode);
graph.addNode('matchJob', jobMatchingNode);
graph.addNode('writeCoverLetter', coverLetterNode);
graph.addNode('prepInterview', interviewPrepNode);
graph.addNode('planStrategy', strategyPlanNode);
graph.addNode('buildReport', compileReportNode);

// Set entry point
graph.setEntryPoint('fetchResumeContext');

// Sequential edges
graph.addEdge('fetchResumeContext', 'analyzeResume');
graph.addEdge('analyzeResume', 'analyzeGaps');

// Conditional edge: job matching only if jobDescription provided
graph.addConditionalEdges('analyzeGaps', shouldRunJobMatching, {
  matchJob: 'matchJob',
  writeCoverLetter: 'writeCoverLetter',
});

// After job matching (if it ran), go to cover letter
graph.addEdge('matchJob', 'writeCoverLetter');

// After cover letter, run interview prep and strategy plan in parallel
graph.addEdge('writeCoverLetter', 'prepInterview');
graph.addEdge('writeCoverLetter', 'planStrategy');

// Both parallel paths converge at buildReport
graph.addEdge('prepInterview', 'buildReport');
graph.addEdge('planStrategy', 'buildReport');

// End
graph.addEdge('buildReport', END);

// Compile the graph
export const reportGraph = graph.compile();


