/**
 * Session CRUD operations.
 * Uses better-sqlite3 sync API.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Session,
  SessionStatus,
  SessionWithActivity,
} from "@agent-recorder/types";

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

export type { SessionWithActivity };

/** Enriched session row with event count and token totals — used by ar_list_sessions */
export interface SessionSummaryRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  createdAt: string;
  lastActivityAt: string | null;
  eventCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errorCount: number;
}

/** List sessions with enriched aggregation from events (for ar_list_sessions) */
export function listSessionsSummary(
  db: Database.Database,
  opts: {
    limit: number;
    offset: number;
    status?: SessionStatus;
    since?: string;
    upstreamKey?: string;
  }
): SessionSummaryRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push("s.status = ?");
    params.push(opts.status);
  }
  if (opts.since) {
    conditions.push("s.started_at >= ?");
    params.push(opts.since);
  }
  if (opts.upstreamKey) {
    conditions.push(
      "EXISTS (SELECT 1 FROM events e2 WHERE e2.session_id = s.id AND e2.upstream_key = ?)"
    );
    params.push(opts.upstreamKey);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(opts.limit, opts.offset);

  const sql = `
    SELECT
      s.id,
      s.started_at,
      s.ended_at,
      s.status,
      s.created_at,
      MAX(e.started_at) AS last_activity_at,
      COUNT(e.id) AS event_count,
      COALESCE(SUM(e.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(e.output_tokens), 0) AS total_output_tokens,
      SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) AS error_count
    FROM sessions s
    LEFT JOIN events e ON e.session_id = s.id
    ${where}
    GROUP BY s.id
    ORDER BY COALESCE(MAX(e.started_at), s.started_at) DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    status: string;
    created_at: string;
    last_activity_at: string | null;
    event_count: number;
    total_input_tokens: number;
    total_output_tokens: number;
    error_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    eventCount: row.event_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    errorCount: row.error_count,
  }));
}

/** List sessions with last activity timestamp from events */
export function listSessionsWithActivity(
  db: Database.Database,
  status?: SessionStatus
): SessionWithActivity[] {
  const query = `
    SELECT
      s.*,
      (SELECT MAX(e.started_at) FROM events e WHERE e.session_id = s.id) as last_activity_at
    FROM sessions s
    ${status ? "WHERE s.status = ?" : ""}
    ORDER BY COALESCE(
      (SELECT MAX(e.started_at) FROM events e WHERE e.session_id = s.id),
      s.started_at
    ) DESC
  `;

  const stmt = db.prepare(query);
  const rows = (status ? stmt.all(status) : stmt.all()) as (SessionRow & {
    last_activity_at: string | null;
  })[];

  return rows.map((row) => ({
    ...rowToSession(row),
    lastActivityAt: row.last_activity_at,
  }));
}
