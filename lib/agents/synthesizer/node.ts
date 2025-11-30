import { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";
import { GapAnalysis } from "@/lib/agents/gap-finder/schema";
import { CoverLetter } from "@/lib/agents/cover-letter/schema";
import { InterviewPrep } from "@/lib/agents/interview-prep/schema";
import { StrategyPlan } from "@/lib/agents/strategy-advisor/schema";

export function synthesizeCareerReport({
  resumeAnalysis,
  gapAnalysis,
  coverLetter,
  interviewPrep,
  strategyPlan,
}: {
  resumeAnalysis: ResumeAnalysis;
  gapAnalysis: GapAnalysis;
  coverLetter: CoverLetter;
  interviewPrep: InterviewPrep;
  strategyPlan: StrategyPlan;
}) {
  return {
    generatedAt: new Date().toISOString(),
    candidate: "Theo Bermudez",
    targetCompany: coverLetter.company,
    resumeAnalysis,
    gapAnalysis,
    coverLetter,
    interviewPrep,
    strategyPlan,
  };
}


