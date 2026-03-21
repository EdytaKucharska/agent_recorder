/**
 * Storage adapter interface for pluggable persistence.
 *
 * Implement this interface to use a custom storage backend
 * (e.g., PostgreSQL, in-memory for tests, cloud storage).
 * The default implementation uses SQLite (in @agent-recorder/core).
 */

import type {
  BaseEvent,
  EventStatus,
  ErrorCategory,
  EventType,
} from "./events.js";
import type { Session, SessionStatus } from "./session.js";

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
  upstreamKey?: string | null;
  startedAt: string;
  endedAt?: string | null;
  status: EventStatus;
  inputJson?: string | null;
  outputJson?: string | null;
  errorCategory?: ErrorCategory | null;
}

/** Query options for paginated event retrieval */
export interface EventQueryOptions {
  /** Only return events with sequence > after (default: 0) */
  after?: number;
  /** Maximum number of events to return (default: 200) */
  limit?: number;
}

/** Filter options for event queries */
export interface EventFilterOptions {
  toolName?: string;
  status?: EventStatus;
  errorCategory?: ErrorCategory;
  upstreamKey?: string;
  sinceSeq?: number;
  limit?: number;
}

/**
 * Abstract storage adapter.
 * All methods should be synchronous or return promises consistently.
 * The SQLite implementation is synchronous; other backends may be async.
 *
 * @alpha This interface is unstable and may change without notice between
 * minor versions. It defines the target contract for pluggable storage
 * backends but is not yet implemented. The current SQLite functions in
 * `@agent-recorder/core` take `Database.Database` directly. Do not depend
 * on this interface in production code.
 */
export interface StorageAdapter {
  // Session operations
  createSession(id: string, startedAt: string): Session;
  endSession(
    id: string,
    endedAt: string,
    status: SessionStatus
  ): Session | null;
  getSessionById(id: string): Session | null;
  listSessions(status?: SessionStatus): Session[];

  // Event operations
  insertEvent(event: InsertEventInput): BaseEvent;
  getEventById(id: string): BaseEvent | null;
  getEventsBySession(sessionId: string): BaseEvent[];
  getEventsBySessionPaginated(
    sessionId: string,
    options?: EventQueryOptions
  ): BaseEvent[];
  countEventsBySession(sessionId: string): number;
  updateEventStatus(
    id: string,
    status: EventStatus,
    endedAt?: string
  ): BaseEvent | null;
  completeEvent(
    id: string,
    status: EventStatus,
    endedAt: string,
    outputJson?: string | null,
    errorCategory?: string | null
  ): BaseEvent | null;
  findRunningEvent(sessionId: string, toolName: string): BaseEvent | null;

  // Sequence operations
  allocateSequence(sessionId: string): number;

  // Lifecycle
  close(): void;
}
