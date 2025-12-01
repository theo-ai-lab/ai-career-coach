// lib/agents/resume-analyzer/node.ts

import { ResumeAnalysisSchema } from "./schema";

import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";

import { OpenAIEmbeddings } from "@langchain/openai";

import { ChatOpenAI } from "@langchain/openai";

import { getSupabase } from "@/lib/supabase";

function getVectorStore() {
  const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
  const supabase = getSupabase();
  return new SupabaseVectorStore(embeddings, {
    client: supabase,
    tableName: "documents",
    queryName: "match_documents",
  });
}

function getLLM() {
  return new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
}

export async function analyzeResume(userId: string, resumeText: string) {
  const vectorstore = getVectorStore();
  const llm = getLLM();

  const retriever = vectorstore.asRetriever({

    filter: { user_id: userId },

    k: 20,

  });



  const context = await retriever.invoke(resumeText);



  const prompt = `You are an elite AI APM resume analyst.

You are analyzing a candidate's resume and retrieved RAG context to produce a structured analysis.

CONTEXT FROM RESUME (free-text upload):
${resumeText}

CONTEXT FROM RAG (retrieved_chunks):
${context.map(c => c.pageContent).join("\n\n")}

SKILL & EDUCATION EXTRACTION RULES (CRITICAL):
- You MUST extract **all skills** listed anywhere in the resume's explicit "Skills" section and include them verbatim in the appropriate arrays under skills. Do not paraphrase or drop items.
- You MUST extract **all majors, minors, and certifications** from the Education section (e.g., "Minor in Artificial Intelligence Applications", "Machine Learning Fundamentals certificate") and reflect them in the education array and, where appropriate, in skills. Do not omit AI-related coursework like "Machine Learning Fundamentals" or "AI Ethics".
- When something could reasonably be treated as either a course or a skill (e.g., "Machine Learning Fundamentals"), add it to education details and also include a corresponding skill token (e.g., "Machine Learning") in the relevant skills.technical/tools list.

CRITICAL GROUNDING RULES:
- You MUST base every claim on specific text in the combined context above.
- Before stating that a skill, tool, domain, or experience is missing, SEARCH the full context for related keywords, abbreviations, or synonyms.
- Never claim a skill, minor, project, or domain is missing if it appears anywhere in the context (for example, if AI ethics, responsible AI, or an AI minor is mentioned, do NOT say it is missing).
- If the context is insufficient to support a claim, say "insufficient data" instead of guessing.

SPECIFICITY REQUIREMENTS:
- Extract and quote specific metrics, numbers, timeframes, and scopes when available (e.g., "improved CTR by 18%", "served 5,000+ users", "3-month experiment").
- Reference actual company names, team names, project names, course titles, and tools as they appear in the context.
- Do NOT use vague phrases like "various projects" or "multiple initiatives"—always use the actual names from the context.
- If the resume shows experience in an area (e.g., RAG, AI ethics, product experimentation), do NOT recommend "gaining experience" in that same area.

OUTPUT FORMAT:
- You MUST return ONLY valid JSON matching this exact schema:
${JSON.stringify(ResumeAnalysisSchema.shape, null, 2)}
- Do not wrap the JSON in markdown code fences.
- Do not include any explanatory text outside the JSON object.
- Where data is genuinely unavailable, use the string "insufficient data" or an empty array, rather than hallucinating.

Return only the JSON object.`;



  return await llm.withStructuredOutput(ResumeAnalysisSchema).invoke(prompt);

}

