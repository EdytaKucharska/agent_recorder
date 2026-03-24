/**
 * Token estimation utility.
 * Uses JSON byte length / 4 approximation — no external dependencies.
 */

/**
 * Estimate token count for any value.
 * Approximation: JSON.stringify length / 4, consistent with GPT-family tokenizers for JSON.
 */
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}
