/**
 * Redaction and truncation utilities for sensitive data.
 */

const REDACTED_VALUE = "[REDACTED]";
const DEFAULT_MAX_LENGTH = 10240; // 10KB

/**
 * Recursively redact sensitive keys from a JSON value.
 * Keys are matched case-insensitively.
 */
export function redactJson(value: unknown, keys: string[]): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, keys));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (lowerKeys.has(k.toLowerCase())) {
        result[k] = REDACTED_VALUE;
      } else {
        result[k] = redactJson(v, keys);
      }
    }
    return result;
  }

  return value;
}

/**
 * Stringify and truncate JSON to a maximum length.
 * If truncated, appends "...[TRUNCATED]" indicator.
 */
export function truncateJson(
  value: unknown,
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  const json = JSON.stringify(value);

  if (json.length <= maxLength) {
    return json;
  }

  const truncatedLength = maxLength - 14; // Length of "...[TRUNCATED]"
  return json.slice(0, truncatedLength) + "...[TRUNCATED]";
}

/**
 * Redact and truncate JSON in one step.
 * Convenience function that combines redactJson and truncateJson.
 */
export function redactAndTruncate(
  value: unknown,
  keys: string[],
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  const redacted = redactJson(value, keys);
  return truncateJson(redacted, maxLength);
}
