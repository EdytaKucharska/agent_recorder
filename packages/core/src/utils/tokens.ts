/**
 * Token estimation utility.
 * Uses JSON byte length / 4 approximation — no external dependencies.
 */

/**
 * Estimate token count for any value.
 * Rough approximation: ~4 characters per token.
 * Accurate enough for context-budget alerting; not suitable for exact billing.
 */
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}
