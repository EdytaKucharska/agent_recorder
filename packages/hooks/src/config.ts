/**
 * Hook handler configuration helpers.
 * Kept separate from handler.ts because the handler is a bin script that
 * runs main() on import — tests import this module instead.
 */

export const DEFAULT_HOOK_TIMEOUT_MS = 500;
export const MAX_HOOK_TIMEOUT_MS = 30_000;

/**
 * Resolve the hook delivery timeout from an env var value.
 *
 * Claude Code waits for the hook process, so this bounds the latency a hung
 * daemon can add to every tool call. Invalid, non-positive, or missing values
 * fall back to the default — note that an explicit "0" is NOT honored as
 * "no timeout"; the wait is always bounded. Values above MAX_HOOK_TIMEOUT_MS
 * are clamped so the bound is real (and stays well under Node's setTimeout
 * ceiling, past which timer behavior varies across versions).
 */
export function resolveHookTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HOOK_TIMEOUT_MS;
  }
  return Math.min(Math.ceil(parsed), MAX_HOOK_TIMEOUT_MS);
}
