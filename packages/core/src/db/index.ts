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
} from "./sessions.js";
export {
  insertEvent,
  getEventById,
  getEventsBySession,
  getEventsBySessionPaginated,
  getEventsBySessionFiltered,
  countEventsBySession,
  updateEventStatus,
  getLatestToolCallEvent,
  type InsertEventInput,
  type EventQueryOptions,
  type EventFilterOptions,
} from "./events.js";
export { allocateSequence, getCurrentSequence } from "./sequences.js";
