import { ChatOpenAI } from "@langchain/openai";
import { CoverLetterSchema } from "./schema";
import type { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";
import type { GapAnalysis } from "@/lib/agents/gap-finder/schema";

function getLLM() {
  return new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.3,
  });
}

export async function writeCoverLetter(
  resume: ResumeAnalysis,
  gaps: GapAnalysis,
  company: string
) {
  const resumeJson = JSON.stringify(resume, null, 2);
  const gapsJson = JSON.stringify(gaps, null, 2);

  const prompt = `
You are a world-class AI career coach writing a cover letter for Theo Bermudez (USC Business + AI '24) applying to ${company}.

You are given:
- Structured resume analysis JSON:
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}

Use this exact 4-paragraph structure:

1. Hook: One bold opening sentence about AI's future + Theo's unique role in it
2. Story: 1-2 specific projects (RAG pipelines, LangGraph agents, full-stack AI apps)
3. Bridge: Directly address the gaps with concrete learning/upskilling actions
4. Close: Passionate call-to-action + gratitude

Tone: Confident, warm, technical but accessible. Never generic.

Use only information that could reasonably be inferred from the provided resume analysis and gap analysis above. Do not invent companies, projects, or technologies that are not implied by that data.

Return ONLY valid JSON matching this schema:
${JSON.stringify(CoverLetterSchema.shape, null, 2)}
`;

  const llm = getLLM();
  return await llm.withStructuredOutput(CoverLetterSchema).invoke(prompt);
}


