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
- Structured resume analysis JSON (grounded in RAG):
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}

CRITICAL GROUNDING RULES:
- You MUST ground every claim in the resumeAnalysis or gapAnalysis JSON above.
- Before implying any missing skill or gap, SEARCH the resumeAnalysis for related keywords or synonyms (e.g., "AI ethics", "responsible AI", "safety").
- Never say a skill, domain, or experience is missing if it appears anywhere in the resume analysis (for example, if an AI minor or AI ethics coursework is present, do NOT say AI ethics is missing).
- If there is insufficient data to support a claim, omit that claim instead of inventing it.

SPECIFICITY REQUIREMENTS:
- Explicitly reference concrete projects, companies, course names, and tools taken from the resumeAnalysis (e.g., specific RAG pipelines, LangGraph agents, or AI apps).
- Extract and include specific metrics, numbers, timeframes, or outcomes when available (e.g., "improved retention by 12%", "deployed to 5,000+ users").
- Do NOT use generic phrases like "various projects" or "multiple initiatives"—always use the actual project names.
- If Theo already has experience in an area, do NOT recommend "gaining experience" there; instead, position that experience as a strength.

STRUCTURE & OUTPUT FORMAT:
- Use this exact 4-paragraph logical structure in the content you generate:
  1. Hook: One bold opening sentence about AI's future + Theo's unique role in it, grounded in specific experience.
  2. Story: 1–2 specific projects (RAG pipelines, LangGraph agents, full-stack AI apps) referencing real project names and metrics from the resume.
  3. Bridge: Address any true gaps from gapAnalysis with concrete, realistic learning/upskilling actions.
  4. Close: Passionate, specific call-to-action and gratitude.
- Tone: Confident, warm, technical but accessible. Never generic.

OUTPUT:
- Return ONLY valid JSON matching this schema:
${JSON.stringify(CoverLetterSchema.shape, null, 2)}
`;

  const llm = getLLM();
  return await llm.withStructuredOutput(CoverLetterSchema).invoke(prompt);
}


