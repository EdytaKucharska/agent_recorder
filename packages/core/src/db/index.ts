/**
 * Database module exports.
 */

export { openDatabase, openMemoryDatabase } from "./connection.js";
export { runMigrations, getDefaultMigrationsDir } from "./migrations.js";
export {
  createSession,
  startSession,
  endSession,
  getSessionById,
  listSessions,
  listSessionsWithActivity,
  listSessionsSummary,
  type SessionWithActivity,
  type SessionSummaryRow,
} from "./sessions.js";
export {
  insertEvent,
  getEventById,
  getEventsBySession,
  getEventsBySessionPaginated,
  getEventsBySessionFiltered,
  countEventsBySession,
  updateEventStatus,
  completeEvent,
  findRunningEvent,
  getLatestToolCallEvent,
  type InsertEventInput,
  type EventQueryOptions,
  type EventFilterOptions,
} from "./events.js";
export { allocateSequence, getCurrentSequence } from "./sequences.js";
export {
  upsertToolSchemaMetric,
  getTokenSummary,
  queryTokenUsageAggregated,
  type UpsertToolSchemaMetricInput,
  type TokenSummary,
  type AggregatedTokenRow,
} from "./token-metrics.js";
export { listUpstreamActivity, type UpstreamActivityRow } from "./upstreams.js";
