// lib/evals/coaching-quality.ts
// LLM-as-judge evaluator for coaching quality

import { ChatOpenAI } from '@langchain/openai';
import { getChatClient } from '@/lib/rag';

export interface CoachingQualityInput {
  query: string;
  response: string;
  contexts: string[];
}

export interface CoachingQualityScores {
  actionability: number;
  personalization: number;
  honesty: number;
  grounding: number;
}

export interface CoachingQualityOutput {
  scores: CoachingQualityScores;
  reasoning: string;
  overall: number;
}

/**
 * Evaluates coaching response quality using LLM-as-judge
 * Scores on 4 criteria (1-5 scale each):
 * - Actionability: Can user act on this advice within 48 hours?
 * - Personalization: Is this specific to their resume, not generic advice?
 * - Honesty: Does it acknowledge uncertainty appropriately?
 * - Grounding: Is every claim traceable to retrieved context?
 */
export async function evaluateCoachingQuality(
  input: CoachingQualityInput
): Promise<CoachingQualityOutput> {
  const llm = getChatClient();
  
  const contextsText = input.contexts.length > 0
    ? input.contexts.map((ctx, i) => `[Context ${i + 1}]\n${ctx}`).join('\n\n')
    : 'No contexts provided';

  const prompt = `You are an expert evaluator of AI coaching responses. Evaluate the following coaching response on 4 criteria, each scored 1-5.

USER QUERY:
${input.query}

RETRIEVED CONTEXTS (from RAG):
${contextsText}

COACHING RESPONSE TO EVALUATE:
${input.response}

EVALUATION CRITERIA:

1. ACTIONABILITY (1-5): Can the user act on this advice within 48 hours?
   - 5: Provides specific, immediate actions with clear steps
   - 4: Provides actionable advice with some specificity
   - 3: Somewhat actionable but vague or requires more context
   - 2: Mostly theoretical or requires significant preparation
   - 1: Not actionable, purely informational or too abstract

2. PERSONALIZATION (1-5): Is this specific to their resume, not generic advice?
   - 5: Highly specific, references exact projects/experiences from contexts
   - 4: Clearly tailored to their background with concrete examples
   - 3: Somewhat personalized but includes generic elements
   - 2: Mostly generic with minimal personalization
   - 1: Completely generic, could apply to anyone

3. HONESTY (1-5): Does it acknowledge uncertainty appropriately?
   - 5: Explicitly acknowledges gaps, uncertainties, and limitations
   - 4: Generally honest, mentions some limitations
   - 3: Somewhat honest but may overstate confidence
   - 2: Overconfident, makes claims without sufficient evidence
   - 1: Makes definitive claims without acknowledging uncertainty

4. GROUNDING (1-5): Is every claim traceable to retrieved context?
   - 5: Every claim directly supported by specific context excerpts
   - 4: Most claims grounded, minor assumptions acceptable
   - 3: Some claims grounded, some appear to be assumptions
   - 2: Many claims not clearly traceable to contexts
   - 1: Claims appear to be invented or not from contexts

OUTPUT FORMAT:
Return ONLY valid JSON with this exact structure:
{
  "scores": {
    "actionability": 1-5,
    "personalization": 1-5,
    "honesty": 1-5,
    "grounding": 1-5
  },
  "reasoning": "Brief explanation of scores (2-3 sentences)",
  "overall": 0-100 (average of the 4 scores, scaled to 0-100)
}

Do not wrap in markdown code fences. Return only the JSON object.`;

  try {
    const response = await llm.invoke(prompt);
    const content = response.content.toString();
    
    // Parse JSON response
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in eval response');
    }
    
    const result = JSON.parse(jsonMatch[0]) as CoachingQualityOutput;
    
    // Validate scores are in range
    const validateScore = (score: number, name: string) => {
      if (score < 1 || score > 5) {
        throw new Error(`${name} score must be between 1 and 5, got ${score}`);
      }
    };
    
    validateScore(result.scores.actionability, 'actionability');
    validateScore(result.scores.personalization, 'personalization');
    validateScore(result.scores.honesty, 'honesty');
    validateScore(result.scores.grounding, 'grounding');
    
    // Calculate overall if not provided or recalculate to ensure accuracy
    const avgScore = (
      result.scores.actionability +
      result.scores.personalization +
      result.scores.honesty +
      result.scores.grounding
    ) / 4;
    result.overall = Math.round((avgScore / 5) * 100);
    
    return result;
  } catch (error: any) {
    throw new Error(`Failed to evaluate coaching quality: ${error.message}`);
  }
}

