/**
 * Event CRUD operations.
 * Uses better-sqlite3 sync API.
 */

import type Database from "better-sqlite3";
import type { BaseEvent, EventStatus, EventType } from "../types/index.js";

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
  started_at: string;
  ended_at: string | null;
  status: string;
  input_json: string | null;
  output_json: string | null;
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
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as EventStatus,
    inputJson: row.input_json,
    outputJson: row.output_json,
    createdAt: row.created_at,
  };
}

/** Input for inserting a new event */
export interface InsertEventInput {
  id: string;
  sessionId: string;
  parentEventId?: string | null;
  sequence: number;
  eventType: EventType;
  agentRole: string;
  agentName: string;
  skillName?: string | null;
  toolName?: string | null;
  mcpMethod?: string | null;
  startedAt: string;
  endedAt?: string | null;
  status: EventStatus;
  inputJson?: string | null;
  outputJson?: string | null;
}

/** Insert a new event */
export function insertEvent(
  db: Database.Database,
  event: InsertEventInput
): BaseEvent {
  const stmt = db.prepare(`
    INSERT INTO events (
      id, session_id, parent_event_id, sequence, event_type,
      agent_role, agent_name, skill_name, tool_name, mcp_method,
      started_at, ended_at, status, input_json, output_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    event.startedAt,
    event.endedAt ?? null,
    event.status,
    event.inputJson ?? null,
    event.outputJson ?? null
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
