/**
 * Session CRUD operations.
 * Uses better-sqlite3 sync API.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Session, SessionStatus } from "../types/index.js";

/** Row shape from SQLite */
interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  created_at: string;
}

/** Convert DB row to Session type */
function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
  };
}

/** Create a new session */
export function createSession(
  db: Database.Database,
  id: string,
  startedAt: string
): Session {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, started_at, status, created_at)
    VALUES (?, ?, 'active', datetime('now'))
  `);
  stmt.run(id, startedAt);

  return getSessionById(db, id)!;
}

/** Create a new session with auto-generated ID. Returns the session. */
export function startSession(db: Database.Database): Session {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  return createSession(db, id, startedAt);
}

/** End a session by setting status and ended_at */
export function endSession(
  db: Database.Database,
  id: string,
  endedAt: string,
  status: SessionStatus = "completed"
): Session | null {
  const stmt = db.prepare(`
    UPDATE sessions SET ended_at = ?, status = ?
    WHERE id = ?
  `);
  const result = stmt.run(endedAt, status, id);

  if (result.changes === 0) {
    return null;
  }

  return getSessionById(db, id);
}

/** Get session by ID */
export function getSessionById(
  db: Database.Database,
  id: string
): Session | null {
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const row = stmt.get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

/** List sessions with optional status filter */
export function listSessions(
  db: Database.Database,
  status?: SessionStatus
): Session[] {
  let stmt;
  if (status) {
    stmt = db.prepare(
      "SELECT * FROM sessions WHERE status = ? ORDER BY started_at DESC"
    );
    return (stmt.all(status) as SessionRow[]).map(rowToSession);
  } else {
    stmt = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC");
    return (stmt.all() as SessionRow[]).map(rowToSession);
  }
}
