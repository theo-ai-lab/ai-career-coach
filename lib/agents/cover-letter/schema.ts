import { z } from "zod";

export const CoverLetterSchema = z.object({
  company: z.string(),
  letter: z
    .string()
    .describe("Full 4-paragraph cover letter in markdown"),
  whyThisRole: z.string(),
  whyThisCompany: z.string(),
  closingCallToAction: z.string(),
});

export type CoverLetter = z.infer<typeof CoverLetterSchema>;


