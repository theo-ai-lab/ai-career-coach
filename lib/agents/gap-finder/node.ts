// lib/agents/gap-finder/node.ts

import { GapAnalysisSchema } from "./schema";

import { ChatOpenAI } from "@langchain/openai";

import { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
}

export async function findGaps(

  resumeAnalysis: ResumeAnalysis,

  jobDescription: string

) {

  const prompt = `

You are an elite AI career strategist. Compare this parsed resume against the job description and return ONLY valid JSON matching this schema:



${JSON.stringify(GapAnalysisSchema.shape, null, 2)}



Resume JSON:

${JSON.stringify(resumeAnalysis, null, 2)}



Job Description:

${jobDescription}



Return only JSON.`;

  const llm = getLLM();
  return await llm.withStructuredOutput(GapAnalysisSchema).invoke(prompt);

}

