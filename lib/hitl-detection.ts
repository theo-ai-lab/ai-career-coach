/**
 * High-stakes detection utility
 * Flags content that involves significant career decisions requiring human review
 */

const HIGH_STAKES_KEYWORDS = [
  // Job transitions
  "resign",
  "quit",
  "leave your job",
  "hand in notice",
  "two weeks notice",
  
  // Salary negotiations
  "negotiate salary",
  "salary negotiation",
  "counteroffer",
  "counter offer",
  "salary expectations",
  "compensation negotiation",
  "ask for more",
  "demand higher",
  
  // Major career changes
  "major career change",
  "career pivot",
  "switch careers",
  "change industries",
  "transition to",
  
  // High-risk advice
  "burn bridges",
  "ultimatum",
  "threaten to leave",
];

/**
 * Detects if content contains high-stakes advice
 * @param content - The text content to analyze
 * @returns true if high-stakes keywords are detected
 */
export function detectHighStakes(content: string): boolean {
  if (!content) return false;
  
  const lowerContent = content.toLowerCase();
  
  // Check for any high-stakes keywords
  return HIGH_STAKES_KEYWORDS.some(keyword => 
    lowerContent.includes(keyword.toLowerCase())
  );
}

/**
 * Detects high-stakes content in structured data (JSON objects)
 * @param data - Object or string to analyze
 * @returns true if high-stakes content is detected
 */
export function detectHighStakesInData(data: any): boolean {
  if (!data) return false;
  
  // Convert to string if it's an object
  const content = typeof data === 'string' 
    ? data 
    : JSON.stringify(data);
  
  return detectHighStakes(content);
}








