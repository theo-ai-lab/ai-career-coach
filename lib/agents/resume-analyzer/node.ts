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



  const prompt = `You are an elite AI APM resume analyst. Return ONLY valid JSON matching this schema:



${JSON.stringify(ResumeAnalysisSchema.shape, null, 2)}



Resume text: ${resumeText}



Relevant RAG context:

${context.map(c => c.pageContent).join("\n\n")}



Return only JSON.`;



  return await llm.withStructuredOutput(ResumeAnalysisSchema).invoke(prompt);

}

