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
- Structured resume analysis JSON:
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}
- Job description:
${jobDescription}

Using his real resume and gap analysis, generate:

- 5 Behavioral questions (leadership, product sense, execution, ownership, collaboration) with perfect STAR answers.
- 5 Technical questions (system design, AI concepts, LangChain/RAG, experimentation, metrics) with detailed, correct answers using his actual projects.

Constraints:
- Answers must be grounded ONLY in the provided resumeAnalysis and gapAnalysis; never invent companies, degrees, or projects that are not implied there.
- Behavioral answers must clearly follow STAR (label sections if helpful).
- Technical answers should reference specific projects (e.g., AI Career Coach, RAG pipelines, LangGraph agents) when appropriate.

Return ONLY valid JSON matching this schema:
${JSON.stringify(InterviewPrepSchema.shape, null, 2)}

Company: ${company}
`;

  const llm = getLLM();
  return await llm.withStructuredOutput(InterviewPrepSchema).invoke(prompt);
}


