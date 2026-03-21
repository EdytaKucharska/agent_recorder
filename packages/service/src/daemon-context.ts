/**
 * Daemon runtime context.
 * Replaces module-level globals with an explicit, testable context object.
 */

export interface DaemonContext {
  mode: "daemon" | "foreground";
  sessionId: string | null;
  startedAt: string | null;
}

/**
 * Create a new daemon context with default values.
 */
export function createDaemonContext(): DaemonContext {
  return {
    mode: "foreground",
    sessionId: null,
    startedAt: null,
  };
}
