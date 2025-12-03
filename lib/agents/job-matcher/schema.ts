import { z } from "zod";

export const JobMatchSchema = z.object({
  matchScore: z.number().min(0).max(100),
  strongMatches: z.array(z.string()),
  gaps: z.array(z.string()),
  keywordsToAdd: z.array(z.string()),
  talkingPoints: z.array(z.string()),
});

export type JobMatch = z.infer<typeof JobMatchSchema>;


