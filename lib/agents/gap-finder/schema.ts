// lib/agents/gap-finder/schema.ts

import { z } from "zod";



export const GapAnalysisSchema = z.object({

  roleFitScore: z.number().min(0).max(100),

  missingTechnicalSkills: z.array(z.string()),

  missingSoftSkills: z.array(z.string()),

  missingExperience: z.array(z.string()),

  priorityUpskilling: z.array(z.object({

    skill: z.string(),

    reason: z.string(),

    resources: z.array(z.string()),

  })),

  overallRecommendation: z.string(),

});



export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;

