/**
 * Event CRUD operations.
 * Uses better-sqlite3 sync API.
 */

import type Database from "better-sqlite3";
import type {
  BaseEvent,
  ErrorCategory,
  EventStatus,
  EventType,
} from "../types/index.js";

import type {
  InsertEventInput,
  EventFilterOptions,
} from "@agent-recorder/types";
export type { InsertEventInput, EventFilterOptions };

/** Row shape from SQLite */
interface EventRow {
  id: string;
  session_id: string;
  parent_event_id: string | null;
  sequence: number;
  event_type: string;
  agent_role: string;
  agent_name: string;
  skill_name: string | null;
  tool_name: string | null;
  mcp_method: string | null;
  upstream_key: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  input_json: string | null;
  output_json: string | null;
  error_category: string | null;
  created_at: string;
}

/** Convert DB row to BaseEvent type */
function rowToEvent(row: EventRow): BaseEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentEventId: row.parent_event_id,
    sequence: row.sequence,
    eventType: row.event_type as EventType,
    agentRole: row.agent_role,
    agentName: row.agent_name,
    skillName: row.skill_name,
    toolName: row.tool_name,
    mcpMethod: row.mcp_method,
    upstreamKey: row.upstream_key,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as EventStatus,
    inputJson: row.input_json,
    outputJson: row.output_json,
    errorCategory: row.error_category as ErrorCategory | null,
    createdAt: row.created_at,
  };
}

/** Insert a new event */
export function insertEvent(
  db: Database.Database,
  event: InsertEventInput
): BaseEvent {
  const stmt = db.prepare(`
    INSERT INTO events (
      id, session_id, parent_event_id, sequence, event_type,
      agent_role, agent_name, skill_name, tool_name, mcp_method, upstream_key,
      started_at, ended_at, status, input_json, output_json, error_category, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  stmt.run(
    event.id,
    event.sessionId,
    event.parentEventId ?? null,
    event.sequence,
    event.eventType,
    event.agentRole,
    event.agentName,
    event.skillName ?? null,
    event.toolName ?? null,
    event.mcpMethod ?? null,
    event.upstreamKey ?? null,
    event.startedAt,
    event.endedAt ?? null,
    event.status,
    event.inputJson ?? null,
    event.outputJson ?? null,
    event.errorCategory ?? null
  );

  return getEventById(db, event.id)!;
}

/** Get event by ID */
export function getEventById(
  db: Database.Database,
  id: string
): BaseEvent | null {
  const stmt = db.prepare("SELECT * FROM events WHERE id = ?");
  const row = stmt.get(id) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/** Get all events for a session, ordered by sequence */
export function getEventsBySession(
  db: Database.Database,
  sessionId: string
): BaseEvent[] {
  const stmt = db.prepare(
    "SELECT * FROM events WHERE session_id = ? ORDER BY sequence ASC"
  );
  return (stmt.all(sessionId) as EventRow[]).map(rowToEvent);
}

/** Query options for getEventsBySessionPaginated */
export interface EventQueryOptions {
  /** Only return events with sequence > after (default: 0) */
  after?: number;
  /** Maximum number of events to return (default: 200) */
  limit?: number;
}

/** Get events for a session with pagination, ordered by sequence ASC */
export function getEventsBySessionPaginated(
  db: Database.Database,
  sessionId: string,
  options: EventQueryOptions = {}
): BaseEvent[] {
  const after = options.after ?? 0;
  const limit = options.limit ?? 200;

  const stmt = db.prepare(
    "SELECT * FROM events WHERE session_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?"
  );
  return (stmt.all(sessionId, after, limit) as EventRow[]).map(rowToEvent);
}

/** Count events for a session (efficient SQL count) */
export function countEventsBySession(
  db: Database.Database,
  sessionId: string
): number {
  const stmt = db.prepare(
    "SELECT COUNT(*) as count FROM events WHERE session_id = ?"
  );
  const row = stmt.get(sessionId) as { count: number };
  return row.count;
}

/** Update an event's status and endedAt */
export function updateEventStatus(
  db: Database.Database,
  id: string,
  status: EventStatus,
  endedAt?: string
): BaseEvent | null {
  const stmt = db.prepare(`
    UPDATE events SET status = ?, ended_at = COALESCE(?, ended_at)
    WHERE id = ?
  `);
  const result = stmt.run(status, endedAt ?? null, id);

  if (result.changes === 0) {
    return null;
  }

  return getEventById(db, id);
}

/** Complete a running event with output and status.
 * When outputJson is omitted (undefined), preserves any existing output_json.
 * When outputJson is explicitly null, clears output_json to null.
 * When outputJson is a string, overwrites output_json with the new value. */
export function completeEvent(
  db: Database.Database,
  id: string,
  status: EventStatus,
  endedAt: string,
  outputJson?: string | null,
  errorCategory?: ErrorCategory | null
): BaseEvent | null {
  // Only preserve existing output when the caller omits outputJson entirely.
  // Explicit null clears the field; a string overwrites it.
  const useCoalesce = outputJson === undefined;
  const sql = useCoalesce
    ? `UPDATE events SET status = ?, ended_at = ?, error_category = ? WHERE id = ?`
    : `UPDATE events SET status = ?, ended_at = ?, output_json = ?, error_category = ? WHERE id = ?`;

  const stmt = db.prepare(sql);
  const result = useCoalesce
    ? stmt.run(status, endedAt, errorCategory ?? null, id)
    : stmt.run(status, endedAt, outputJson, errorCategory ?? null, id);

  if (result.changes === 0) {
    return null;
  }

  return getEventById(db, id);
}

/**
 * Find the most recent "running" event for a given tool name in a session.
 * Used to match PreToolUse → PostToolUse.
 *
 * Known limitation: if the same tool fires in parallel, this matches the most
 * recent instance by sequence. PostToolUse may complete the wrong event.
 * This assumes sequential tool execution per session, which holds for Claude
 * Code's current architecture. If parallel tool use is added, this should
 * match by a correlation ID instead.
 */
export function findRunningEvent(
  db: Database.Database,
  sessionId: string,
  toolName: string
): BaseEvent | null {
  const stmt = db.prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND tool_name = ? AND status = 'running'
    ORDER BY sequence DESC
    LIMIT 1
  `);
  const row = stmt.get(sessionId, toolName) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/** Get events for a session with filters (for CLI grep/search) */
export function getEventsBySessionFiltered(
  db: Database.Database,
  sessionId: string,
  options: EventFilterOptions = {}
): BaseEvent[] {
  const conditions: string[] = ["session_id = ?"];
  const params: unknown[] = [sessionId];

  if (options.toolName) {
    conditions.push("tool_name = ?");
    params.push(options.toolName);
  }
  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.errorCategory) {
    conditions.push("error_category = ?");
    params.push(options.errorCategory);
  }
  if (options.upstreamKey) {
    conditions.push("upstream_key = ?");
    params.push(options.upstreamKey);
  }
  if (options.sinceSeq !== undefined) {
    conditions.push("sequence > ?");
    params.push(options.sinceSeq);
  }

  let sql = `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY sequence ASC`;
  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const stmt = db.prepare(sql);
  return (stmt.all(...params) as EventRow[]).map(rowToEvent);
}

/**
 * Get the most recent tool_call event for a session.
 * Used by doctor command to show recording health.
 */
export function getLatestToolCallEvent(
  db: Database.Database,
  sessionId: string
): BaseEvent | null {
  const stmt = db.prepare(`
    SELECT * FROM events
    WHERE session_id = ? AND event_type = 'tool_call'
    ORDER BY sequence DESC
    LIMIT 1
  `);
  const row = stmt.get(sessionId) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}
