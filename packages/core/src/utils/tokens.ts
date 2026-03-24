/**
 * Token estimation utility.
 * Uses UTF-8 byte length / 4 approximation — no external dependencies.
 */

const _encoder = new TextEncoder();

/**
 * Estimate token count for any value.
 * Rough approximation: ~4 UTF-8 bytes per token.
 * Uses TextEncoder for byte-accurate counting (handles non-ASCII correctly).
 * Accurate enough for context-budget alerting; not suitable for exact billing.
 *
 * Pass raw values/objects only. For pre-serialized strings use
 * `Math.ceil(new TextEncoder().encode(str).length / 4)` directly — passing a
 * string here will double-serialize it (JSON.stringify wraps strings in quotes),
 * inflating the estimate.
 */
export function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  return Math.ceil(_encoder.encode(JSON.stringify(value)).length / 4);
}
