/**
 * Session lifecycle manager for daemon.
 * Creates session on boot, ends on shutdown.
 */

import type Database from "better-sqlite3";
import {
  startSession,
  endSession,
  type SessionStatus,
} from "@agent-recorder/core";

export interface SessionManager {
  readonly sessionId: string;
  shutdown(status?: SessionStatus): void;
}

/**
 * Create a session manager that starts a new session immediately.
 * The session is created in the database with status "active".
 */
export function createSessionManager(db: Database.Database): SessionManager {
  // Core generates the ID
  const session = startSession(db);
  console.log(`Session started: ${session.id}`);

  return {
    sessionId: session.id,
    shutdown(status: SessionStatus = "cancelled") {
      endSession(db, session.id, new Date().toISOString(), status);
      console.log(`Session ended: ${session.id} (${status})`);
    },
  };
}
