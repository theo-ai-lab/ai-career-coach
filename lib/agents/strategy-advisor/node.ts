import { ChatOpenAI } from "@langchain/openai";
import { StrategyPlanSchema } from "./schema";

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o", temperature: 0.3 });
}

export async function generateStrategy(
  resumeAnalysis: any,
  gapAnalysis: any,
  targetCompany: string
) {
  const resumeJson = JSON.stringify(resumeAnalysis, null, 2);
  const gapsJson = JSON.stringify(gapAnalysis, null, 2);

  const prompt = `
You are the world's best AI career strategist. Theo Bermudez (USC '24, built full-stack LangGraph agents, RAG systems, Next.js AI apps) wants to land an APM role at ${targetCompany} in 6 months.

You are given:
- Structured resume analysis JSON:
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}

Using his real resume and gap analysis, create a hyper-detailed, executable 6-month plan with:
- A single clear sixMonthGoal.
- For each month 1-6: a focus, keyMilestones (2-4), weeklyActions (at least 3-5), and resources (links or concrete resource names).

Assume Theo has ~10-12 hours per week to invest.

Constraints:
- Ground the plan ONLY in the skills and gaps implied by the analysis; do not invent degrees or experience he doesn't have.
- Make weeklyActions concrete and time-bounded (e.g. "Ship X", "Complete Y course", "Run Z experiment").

Return ONLY valid JSON matching this schema:
${JSON.stringify(StrategyPlanSchema.shape, null, 2)}

Make it so good that following it gives Theo the best possible chance of an offer at ${targetCompany}.
`;

  const llm = getLLM();
  return await llm.withStructuredOutput(StrategyPlanSchema).invoke(prompt);
}


