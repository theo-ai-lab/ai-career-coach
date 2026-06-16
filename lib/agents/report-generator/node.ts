import { synthesizeCareerReport } from "@/lib/agents/synthesizer/node";

export async function generateReport(
  data: Parameters<typeof synthesizeCareerReport>[0],
) {
  const report = synthesizeCareerReport(data);

  const markdown = `
# AI Career Coach — Full Report for ${report.candidate}

**Target:** ${report.targetCompany} APM Role  
**Generated:** ${new Date(report.generatedAt).toLocaleDateString()}

## Resume Analysis
${report.resumeAnalysis.summary ?? ""}

## Gap Analysis (Fit Score: ${report.gapAnalysis.roleFitScore}/100)
${report.gapAnalysis.missingTechnicalSkills
  .map((s: string) => `- ${s}`)
  .join("\n") || "None"}

## Personalized Cover Letter
${report.coverLetter.letter}

## Interview Preparation (10 Questions)
${report.interviewPrep.behavioral
  .map(
    (q) =>
      `**Q:** ${q.question}\n**A:** ${q.answer}`
  )
  .join("\n\n")}

## 6-Month Strategy Plan
${report.strategyPlan.monthlyBreakdown
  .map(
    (m) =>
      `### Month ${m.month}: ${m.focus}\n${m.keyMilestones
        .map((km: string) => `- ${km}`)
        .join("\n")}`
  )
  .join("\n\n")}

**Produced by AI Career Coach — built with LangGraph and Supabase RAG.**
`;

  return {
    markdown,
    // We return markdown, so use .md extension; user can print/export to PDF.
    filename: `${report.candidate.replace(/\s+/g, "_")}_${report.targetCompany}_Career_Report.md`,
  };
}

