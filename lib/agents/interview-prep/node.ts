import { ChatOpenAI } from "@langchain/openai";
import { InterviewPrepSchema } from "./schema";

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o", temperature: 0.2 });
}

export async function generateInterviewPrep(
  resumeAnalysis: any,
  gapAnalysis: any,
  jobDescription: string,
  company: string
) {
  const resumeJson = JSON.stringify(resumeAnalysis, null, 2);
  const gapsJson = JSON.stringify(gapAnalysis, null, 2);

  const prompt = `
You are an elite AI interview coach preparing Theo Bermudez (USC '24, built full-stack LangGraph agents, RAG pipelines, Next.js AI apps) for a ${company} APM interview.

You are given:
- Structured resume analysis JSON (grounded in RAG):
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}
- Job description:
${jobDescription}

CRITICAL GROUNDING RULES:
- Every question and answer MUST be grounded in the provided resumeAnalysis, gapAnalysis, and job description.
- Before mentioning a gap or "area to improve", SEARCH the resumeAnalysis for related keywords and existing experience; never say the candidate lacks a skill that is clearly present (e.g., RAG, AI ethics, experimentation).
- If the context is insufficient to support a specific example, respond with "insufficient data" rather than inventing details.

SPECIFICITY REQUIREMENTS:
- Behavioral answers MUST follow STAR and reference specific projects, company names, tools, and metrics from the resumeAnalysis (e.g., concrete project names, user impact, performance improvements, timelines).
- Technical answers MUST reference actual systems, projects, and tools from the resumeAnalysis when applicable (e.g., named RAG systems, LangGraph agents, Next.js apps) and quote any concrete metrics or constraints mentioned.
- Avoid vague phrases like "various projects" or "multiple initiatives"—always use actual project names or team names when available.

ANTI-GENERIC GUIDELINES:
- Do NOT recommend "gaining experience" in areas where the resume already shows experience; instead, frame those areas as strengths or as opportunities to deepen expertise.
- Tailor both questions and answers to the specific ${company} APM role and its job description.

OUTPUT FORMAT:
- Generate:
  - 5 behavioral questions (leadership, product sense, execution, ownership, collaboration) with STAR-formatted answers.
  - 5 technical questions (system design, AI concepts, LangChain/RAG, experimentation, metrics) with detailed answers grounded in actual projects.
- Return ONLY valid JSON matching this exact schema:
${JSON.stringify(InterviewPrepSchema.shape, null, 2)}
- Do not include markdown fences or any text outside the JSON object.
`;

  const llm = getLLM();
  return await llm.withStructuredOutput(InterviewPrepSchema).invoke(prompt);
}


