// lib/agents/gap-finder/node.ts

import { GapAnalysisSchema } from "./schema";
import { ChatOpenAI } from "@langchain/openai";
import { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";
import type { JobMatch } from "@/lib/agents/job-matcher/schema";

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
}

export async function findGaps(

  resumeAnalysis: ResumeAnalysis,

  jobDescription: string,

  jobMatch?: JobMatch

) {

  const prompt = `
You are an elite AI career strategist analyzing fit between a candidate and a specific target role.

You are given:
- Parsed resume analysis JSON (grounded in RAG):
${JSON.stringify(resumeAnalysis, null, 2)}
- Job description text:
${jobDescription}
- Optional job-resume match analysis JSON (if provided by a separate job-matcher agent):
${jobMatch ? JSON.stringify(jobMatch, null, 2) : "null"}

CRITICAL GROUNDING RULES:
- You MUST treat the resume analysis JSON as ground truth for the candidate's background.
- If a job-resume match analysis JSON is provided, treat it as the *authoritative comparison* between the resume and the job description. Do NOT re-compare the raw job description from scratch; instead, use its "strongMatches", "gaps", "keywordsToAdd", and "talkingPoints" to inform your gap analysis.
- Before listing any "missingTechnicalSkills", "missingSoftSkills", or "missingExperience", SEARCH the resume analysis for related keywords, synonyms, and closely related concepts.
- In particular, you MUST check the following before claiming any skill is missing:
  - the core technical, soft, and tools skills arrays,
  - any education entries (including majors, minors, named courses, and AI-related programs),
  - any certifications or named programs referenced in education or experience.
- Never claim a skill, tool, or domain is missing if it appears anywhere in the resume analysis (for example, if AI ethics, responsible AI, or an AI minor is present, do NOT say "AI Ethics" or "AI" is missing).
- If the evidence is ambiguous, mark the gap as "insufficient data" instead of fabricating a missing skill.

SPECIFICITY REQUIREMENTS:
- When listing gaps or recommendations, reference specific projects, course names, or tools from the resume analysis where relevant.
- Prefer specific phrasing like "deepen experience in RAG evaluation beyond project X" instead of generic "gain experience with RAG".
- If the candidate already has experience in an area, do NOT recommend "gaining experience" in that same area; instead, focus on leveling up or extending that experience.

ANTI-GENERIC GUIDELINES:
- Do NOT use placeholder phrases like "various projects" or "multiple initiatives"—use actual names from the resume analysis when possible.
- Keep recommendations concrete and actionable (mention specific skills, frameworks, or outcomes).

OUTPUT FORMAT:
- Return ONLY valid JSON matching this exact schema:
${JSON.stringify(GapAnalysisSchema.shape, null, 2)}
- "roleFitScore" must be a number between 0 and 100.
- Each list field MUST be an array of strings.
- Where you lack enough information to be precise, use "insufficient data" in that field rather than inventing content.
- Do not wrap the JSON in markdown code fences or include any surrounding text.

Return only the JSON object.`;

  const llm = getLLM();
  return await llm.withStructuredOutput(GapAnalysisSchema).invoke(prompt);

}

