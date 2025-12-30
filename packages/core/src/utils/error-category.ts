/**
 * Error category derivation.
 * Determines error_category from status and outputJson WITHOUT logging content.
 * Categories are stable enum-like strings - no raw error messages.
 */

import type { ErrorCategory, EventStatus } from "../types/index.js";

/**
 * Derive error category from event status and output.
 * CRITICAL: This function must NOT log or expose output content.
 *
 * Decision tree (EXACT):
 * 1. If status === "success" | "running" | "cancelled" → null
 * 2. If status === "timeout" → "downstream_timeout"
 * 3. If JSON-RPC error AND code === -32000 AND message contains "connect"
 *    → "downstream_unreachable"
 * 4. If JSON-RPC error AND (code === -32700 OR code === -32600)
 *    → "jsonrpc_invalid"
 * 5. If downstream returned JSON-RPC error object → "jsonrpc_error"
 * 6. Otherwise → "unknown"
 */
export function deriveErrorCategory(
  status: EventStatus,
  outputJson: string | null
): ErrorCategory | null {
  // Not an error status - no category needed
  if (status === "success" || status === "running" || status === "cancelled") {
    return null;
  }

  // Timeout status always maps to downstream_timeout
  if (status === "timeout") {
    return "downstream_timeout";
  }

  // status === "error" - parse outputJson to determine category
  if (!outputJson) {
    return "unknown";
  }

  try {
    const output = JSON.parse(outputJson);

    // Check for JSON-RPC error structure: { code: number, message?: string }
    if (output && typeof output === "object" && "code" in output) {
      const code = output.code as number;
      const message =
        typeof output.message === "string" ? output.message.toLowerCase() : "";

      // -32000 with "connect" -> downstream_unreachable
      if (code === -32000 && message.includes("connect")) {
        return "downstream_unreachable";
      }

      // -32700 (Parse error) or -32600 (Invalid Request) -> jsonrpc_invalid
      if (code === -32700 || code === -32600) {
        return "jsonrpc_invalid";
      }

      // Any other JSON-RPC error object -> jsonrpc_error
      return "jsonrpc_error";
    }

    // Has some structure but not a JSON-RPC error
    return "unknown";
  } catch {
    // JSON parse failed
    return "unknown";
  }
}
