// lib/agents.ts
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, END } from '@langchain/langgraph';

// Initialize clients lazily to avoid module load errors
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }
  return createClient(url, key);
}

function getLLM() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new ChatOpenAI({ 
    model: 'gpt-4o-mini', 
    temperature: 0.3,
    openAIApiKey: apiKey
  });
}

function getEmbeddings() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAIEmbeddings({ 
    model: 'text-embedding-3-small',
    openAIApiKey: apiKey
  });
}

async function getDocs(type: 'resume' | 'job') {
  try {
    const supabase = getSupabase();
    const embeddings = getEmbeddings();
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: supabase,
      tableName: 'documents',
    });
    const retriever = vectorStore.asRetriever({ k: 10, filter: { metadata: { type } } });
    const docs = await retriever.invoke('');
    
    if (!docs || docs.length === 0) {
      return `No ${type} document found.`;
    }
    
    return docs.map(d => d.pageContent).join('\n\n');
  } catch (error: any) {
    console.error(`Error getting ${type} docs:`, error);
    return `Error retrieving ${type} documents: ${error.message}`;
  }
}

const resumeAnalyzer = async (state: any) => {
  try {
    const resume = await getDocs('resume');
    const llm = getLLM();
    const result = await llm.invoke(`Extract JSON with keys: skills, experience, education, achievements, strengths from this resume:\n\n${resume}`);
    return { resumeAnalysis: result.content };
  } catch (error: any) {
    return { resumeAnalysis: `Error: ${error.message}` };
  }
};

const jobAnalyzer = async (state: any) => {
  try {
    const job = await getDocs('job');
    const llm = getLLM();
    const result = await llm.invoke(`Extract JSON with keys: requiredSkills, niceToHave, responsibilities, companyValues from this job description:\n\n${job}`);
    return { jobAnalysis: result.content };
  } catch (error: any) {
    return { jobAnalysis: `Error: ${error.message}` };
  }
};

const gapFinder = async (state: any) => {
  try {
    const llm = getLLM();
    const prompt = `Compare resume and job. Output JSON with gaps, strengths, 3 tailored projects to build, and confidence score (0-100):\n\nResume: ${state.resumeAnalysis}\nJob: ${state.jobAnalysis}`;
    const result = await llm.invoke(prompt);
    return { gaps: result.content };
  } catch (error: any) {
    return { gaps: `Error: ${error.message}` };
  }
};

const coverLetterWriter = async (state: any) => {
  try {
    const llm = getLLM();
    const prompt = `Write a powerful 4-paragraph cover letter using resume strengths and addressing gaps:\n\nResume: ${state.resumeAnalysis}\nJob: ${state.jobAnalysis}\nGaps: ${state.gaps}`;
    const result = await llm.invoke(prompt);
    return { coverLetter: result.content };
  } catch (error: any) {
    return { coverLetter: `Error: ${error.message}` };
  }
};

const finalReport = async (state: any) => {
  try {
    const llm = getLLM();
    const prompt = `Compile a beautiful Markdown report with:
- Confidence Score
- Top 5 Matching Skills
- 3 Gaps + How to Close Them
- Full Cover Letter
- 5 Interview Questions + Answers

Data: ${JSON.stringify(state)}`;
    const result = await llm.invoke(prompt);
    return { finalReport: result.content };
  } catch (error: any) {
    return { finalReport: `Error: ${error.message}` };
  }
};

// Build the graph
const graph = new StateGraph({
  channels: {
    resumeAnalysis: null,
    jobAnalysis: null,
    gaps: null,
    coverLetter: null,
    finalReport: null,
  },
});

graph.addNode("analyzeResume", resumeAnalyzer);
graph.addNode("analyzeJob", jobAnalyzer);
graph.addNode("findGaps", gapFinder);
graph.addNode("writeCoverLetter", coverLetterWriter);
graph.addNode("generateReport", finalReport);

// Sequential flow for reliability
graph.setEntryPoint("analyzeResume");
graph.addEdge("analyzeResume", "analyzeJob");
graph.addEdge("analyzeJob", "findGaps");
graph.addEdge("findGaps", "writeCoverLetter");
graph.addEdge("writeCoverLetter", "generateReport");
graph.addEdge("generateReport", END);

// Compile the graph - wrap in function to avoid module load errors
function createCareerAgent() {
  try {
    return graph.compile();
  } catch (error: any) {
    console.error('Error compiling graph:', error);
    // Return a fallback agent
    return {
      invoke: async () => ({
        finalReport: `Error: Failed to compile agent graph: ${error.message}`
      })
    };
  }
}

export const careerAgent = createCareerAgent();