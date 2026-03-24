/**
 * Token estimation utility.
 * Uses JSON byte length / 4 approximation — no external dependencies.
 */

/**
 * Estimate token count for any value.
 * Rough approximation: ~4 characters per token.
 * Accurate enough for context-budget alerting; not suitable for exact billing.
 *
 * Pass raw values/objects only. For pre-serialized strings use
 * `Math.ceil(str.length / 4)` directly — passing a string here will
 * double-serialize it (JSON.stringify wraps strings in quotes), inflating the estimate.
 */
export function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  return Math.ceil(JSON.stringify(value).length / 4);
}
