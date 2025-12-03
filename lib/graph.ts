// lib/graph.ts — add this node (create file if missing)

import { StateGraph } from "@langchain/langgraph";
import { analyzeResume } from "@/lib/agents/resume-analyzer/node";
import { findGaps } from "@/lib/agents/gap-finder/node";
import { writeCoverLetter } from "@/lib/agents/cover-letter/node";
import { generateInterviewPrep } from "@/lib/agents/interview-prep/node";
import { generateStrategy } from "@/lib/agents/strategy-advisor/node";



// Add to your existing graph

const graph = new StateGraph<any>({
  channels: {
    userId: null,
    resumeText: null,
    resumeAnalysis: null,
    jobDescription: null,
    jobMatch: null,
    gapAnalysis: null,
    coverLetter: null,
    interviewPrep: null,
    strategyPlan: null,
  },
});



graph.addNode("resume_analyzer", async (state: any) => {

  const analysis = await analyzeResume(state.userId, state.resumeText);

  return { ...state, resumeAnalysis: analysis };

});



graph.addNode("gap_finder", async (state: any) => {
  const gaps = await findGaps(
    state.resumeAnalysis,
    state.jobDescription,
    state.jobMatch
  );
  return { ...state, gapAnalysis: gaps };
});

graph.addNode("cover_letter_writer", async (state: any) => {
  const letter = await writeCoverLetter(
    state.resumeAnalysis,
    state.gapAnalysis,
    state.targetCompany || "OpenAI"
  );
  return { ...state, coverLetter: letter };
});

graph.addNode("interview_prep", async (state: any) => {
  const prep = await generateInterviewPrep(
    state.resumeAnalysis,
    state.gapAnalysis,
    state.jobDescription,
    state.targetCompany || "OpenAI",
    state.jobMatch
  );
  return { ...state, interviewPrep: prep };
});

graph.addNode("strategy_advisor", async (state: any) => {
  const plan = await generateStrategy(
    state.resumeAnalysis,
    state.gapAnalysis,
    state.targetCompany || "OpenAI",
    state.jobMatch
  );
  return { ...state, strategyPlan: plan };
});

export { graph };

