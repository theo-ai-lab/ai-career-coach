import { ChatOpenAI } from "@langchain/openai";
import { InterviewPrepSchema } from "./schema";
import { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";
import { GapAnalysis } from "@/lib/agents/gap-finder/schema";

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o", temperature: 0.2 });
}

export async function generateInterviewPrep(
  resumeAnalysis: ResumeAnalysis,
  gapAnalysis: GapAnalysis,
  jobDescription: string,
  company: string
) {
  const resumeJson = JSON.stringify(resumeAnalysis, null, 2);
  const gapsJson = JSON.stringify(gapAnalysis, null, 2);

  const prompt = `
You are an elite AI interview coach preparing the candidate (whose background is provided in the resumeAnalysis below) for an interview at ${company} for the target role.

You are given:
- Structured resume analysis JSON:
${resumeJson}
- Structured gap analysis JSON:
${gapsJson}
- Job description:
${jobDescription}

Using the candidate's real resume and gap analysis, generate:

- 5 Behavioral questions (leadership, product sense, execution, ownership, collaboration) with perfect STAR answers.
- 5 Technical questions (system design, AI concepts, LangChain/RAG, experimentation, metrics) with detailed, correct answers using the candidate's actual projects.

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


