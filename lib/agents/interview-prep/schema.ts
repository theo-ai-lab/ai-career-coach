import { z } from "zod";

export const InterviewPrepSchema = z.object({
  behavioral: z.array(
    z.object({
      question: z.string(),
      answer: z
        .string()
        .describe("STAR format answer using Theo's real experience"),
    })
  ),
  technical: z.array(
    z.object({
      question: z.string(),
      answer: z
        .string()
        .describe(
          "Detailed technical explanation with real project examples"
        ),
    })
  ),
  mockInterviewSummary: z.string(),
});

export type InterviewPrep = z.infer<typeof InterviewPrepSchema>;


