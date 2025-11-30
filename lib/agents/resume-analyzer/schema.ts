// lib/agents/resume-analyzer/schema.ts

import { z } from "zod";



export const ResumeAnalysisSchema = z.object({

  summary: z.string().describe("One-paragraph executive summary"),

  education: z.array(z.object({

    degree: z.string(),

    school: z.string(),

    graduationYear: z.string().optional(),

    gpa: z.string().optional(),

  })),

  experience: z.array(z.object({

    company: z.string(),

    role: z.string(),

    duration: z.string(),

    bullets: z.array(z.string()),

  })),

  skills: z.object({

    technical: z.array(z.string()),

    soft: z.array(z.string()),

    tools: z.array(z.string()),

  }),

  strengths: z.array(z.string()),

  gaps: z.array(z.string()),

  atsScore: z.number().min(0).max(100),

  recommendations: z.array(z.string()),

});



export type ResumeAnalysis = z.infer<typeof ResumeAnalysisSchema>;

