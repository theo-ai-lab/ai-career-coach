import { ChatOpenAI } from "@langchain/openai";
import { StrategyPlanSchema } from "./schema";
import { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";
import { GapAnalysis } from "@/lib/agents/gap-finder/schema";

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o", temperature: 0.3 });
}

export async function generateStrategy(
  resumeAnalysis: ResumeAnalysis,
  gapAnalysis: GapAnalysis,
  targetCompany: string
) {
  const resumeJson = JSON.stringify(resumeAnalysis, null, 2);
  const gapsJson = JSON.stringify(gapAnalysis, null, 2);

  const prompt = `
You are the world's best AI career strategist. The candidate (whose background is provided in the resumeAnalysis below) wants to land the target role at ${targetCompany} in 6 months.

You are given:
- Structured resume analysis JSON:
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}

Using the candidate's real resume and gap analysis, create a hyper-detailed, executable 6-month plan with:
- A single clear sixMonthGoal.
- For each month 1-6: a focus, keyMilestones (2-4), weeklyActions (at least 3-5), and resources (links or concrete resource names).

Assume the candidate has ~10-12 hours per week to invest.

Constraints:
- Ground the plan ONLY in the skills and gaps implied by the analysis; do not invent degrees or experience the candidate doesn't have.
- Make weeklyActions concrete and time-bounded (e.g. "Ship X", "Complete Y course", "Run Z experiment").

Return ONLY valid JSON matching this schema:
${JSON.stringify(StrategyPlanSchema.shape, null, 2)}

Make it so good that following it gives the candidate the best possible chance of an offer at ${targetCompany}.
`;

  const llm = getLLM();
  return await llm.withStructuredOutput(StrategyPlanSchema).invoke(prompt);
}


