import { ChatOpenAI } from "@langchain/openai";
import { StrategyPlanSchema } from "./schema";
import type { JobMatch } from "@/lib/agents/job-matcher/schema";

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o", temperature: 0.3 });
}

export async function generateStrategy(
  resumeAnalysis: any,
  gapAnalysis: any,
  targetCompany: string,
  jobMatch?: JobMatch
) {
  const resumeJson = JSON.stringify(resumeAnalysis, null, 2);
  const gapsJson = JSON.stringify(gapAnalysis, null, 2);
  const jobMatchJson = jobMatch ? JSON.stringify(jobMatch, null, 2) : "null";

  const prompt = `
You are the world's best AI career strategist. Theo Bermudez (USC '24, built full-stack LangGraph agents, RAG systems, Next.js AI apps) wants to land an APM role at ${targetCompany} in 6 months.

You are given:
- Structured resume analysis JSON (grounded in RAG):
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}
- Optional job-resume match analysis JSON from a dedicated job-matcher agent:
${jobMatchJson}

CRITICAL GROUNDING RULES:
- Treat the resumeAnalysis and gapAnalysis as ground truth; do NOT invent new degrees, roles, or domains.
- If jobMatchJson is provided (not null), treat its "gaps", "keywordsToAdd", and "talkingPoints" as the authoritative comparison between Theo's resume and this specific role. Use that to prioritize which skills and experiences to focus on over the next 6 months.
- Before recommending that Theo "gain experience" in any area, SEARCH the resumeAnalysis and jobMatchJson; only label it as a gap if it is truly absent from the resume and identified as a gap or missing keyword in the job match.
- Never claim a skill or domain (e.g., AI ethics, RAG, product experimentation) is missing when it appears in the analysis, including synonyms and related coursework (e.g., AI minor).
- Where the analysis lacks clear evidence for a recommendation, explicitly mark that recommendation as based on "insufficient data" rather than hallucinating specifics.

SPECIFICITY REQUIREMENTS:
- Use concrete project names, company names, and tools from the resumeAnalysis when proposing keyMilestones and weeklyActions.
- Extract and reference specific metrics, timeframes, and outcomes where available (e.g., "ship X v1 in 4 weeks", "improve metric Y by Z%").
- Avoid generic phrases such as "work on various projects"—instead, specify the actual type of project and tie it back to resume context or realistic extensions of it.

PLAN STRUCTURE:
- Assume Theo has ~10–12 hours per week to invest.
- Create a single clear "sixMonthGoal" that is measurable.
- For each month 1–6, provide:
  - "focus": a concise theme grounded in actual gaps from gapAnalysis.
  - "actions": a list of concrete, time-bounded steps (e.g., "Ship <projectName> v1", "Complete <specific course>", "Run <specific experiment> with metric target").
- Ensure that recommended actions do NOT ask Theo to "start from zero" in areas where he already has experience; instead, focus on deepening, productizing, or scaling that experience.

OUTPUT FORMAT:
- Return ONLY valid JSON matching this exact schema:
${JSON.stringify(StrategyPlanSchema.shape, null, 2)}
- Do not wrap the JSON in markdown code fences or include any non-JSON text.

Make this plan so targeted and grounded that following it gives Theo the best realistic chance of an offer at ${targetCompany}. 
`;

  const llm = getLLM();
  return await llm.withStructuredOutput(StrategyPlanSchema).invoke(prompt);
}


