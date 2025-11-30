import { z } from "zod";

export const StrategyPlanSchema = z.object({
  targetCompany: z.string(),
  sixMonthGoal: z.string(),
  monthlyBreakdown: z.array(
    z.object({
      month: z.number(),
      focus: z.string(),
      keyMilestones: z.array(z.string()),
      weeklyActions: z.array(z.string()),
      resources: z.array(z.string()),
    })
  ),
  finalRecommendation: z.string(),
});

export type StrategyPlan = z.infer<typeof StrategyPlanSchema>;


