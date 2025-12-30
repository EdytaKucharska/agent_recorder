/**
 * Session types for Agent Recorder.
 * A session represents a single Claude Code execution run.
 */

/** Status of a recording session */
export type SessionStatus = "active" | "completed" | "error" | "cancelled";

/**
 * A recording session containing a tree of events.
 */
export interface Session {
  /** Unique session ID (UUID) */
  id: string;

  /** When the session started (ISO 8601) */
  startedAt: string;

  /** When the session ended (ISO 8601, null if still active) */
  endedAt: string | null;

  /** Current status of this session */
  status: SessionStatus;

  /** When this record was created (ISO 8601) */
  createdAt: string;
}
