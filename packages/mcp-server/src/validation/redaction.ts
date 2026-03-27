/**
 * Prompt stripping and field redaction for write-path tool inputs.
 *
 * Two-pass pipeline:
 *   1. stripSensitiveKeys  — removes keys that could contain prompts/reasoning
 *   2. applyRedaction      — replaces values of user-configured AR_REDACT_KEYS with [REDACTED]
 *
 * Strip happens before redact: better to lose data than to leak it.
 */

/** Keys that may carry prompt or chain-of-thought content — silently dropped */
const STRIPPED_KEYS = new Set([
  "prompt",
  "system_prompt",
  "reasoning",
  "chain_of_thought",
  "messages",
  "thought",
  "thinking",
]);

/**
 * Recursively remove any keys matching STRIPPED_KEYS from an object.
 * Arrays are traversed but their indices are not filtered.
 */
export function stripSensitiveKeys(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (STRIPPED_KEYS.has(k)) continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      result[k] = stripSensitiveKeys(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      result[k] = v.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? stripSensitiveKeys(item as Record<string, unknown>)
          : item
      );
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Replace values whose keys match redactKeys with "[REDACTED]".
 * Operates recursively on objects. Arrays are traversed but indices not filtered.
 */
export function applyRedaction(obj: unknown, redactKeys: string[]): unknown {
  if (redactKeys.length === 0) return obj;
  if (obj === null || typeof obj !== "object") return obj;

  const keySet = new Set(redactKeys.map((k) => k.toLowerCase()));

  function redact(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(redact);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = keySet.has(k.toLowerCase()) ? "[REDACTED]" : redact(v);
    }
    return result;
  }

  return redact(obj);
}

/** Truncate a string to maxLen bytes, appending "…" if truncated */
export function truncateString(str: string, maxLen = 2048): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

/**
 * Full write-path pipeline: strip sensitive keys, then apply redaction.
 * Input must be a plain object or null.
 */
export function sanitizePayload(
  payload: Record<string, unknown> | null | undefined,
  redactKeys: string[]
): Record<string, unknown> | null {
  if (payload == null) return null;
  const stripped = stripSensitiveKeys(payload);
  return applyRedaction(stripped, redactKeys) as Record<string, unknown>;
}
