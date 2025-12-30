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
  countEventsBySession,
  updateEventStatus,
  type InsertEventInput,
} from "./events.js";
export { allocateSequence, getCurrentSequence } from "./sequences.js";
