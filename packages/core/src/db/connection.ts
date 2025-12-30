/**
 * SQLite database connection management.
 * Uses better-sqlite3 sync API.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Opens or creates a SQLite database at the given path.
 * Ensures the parent directory exists.
 */
export function openDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  return db;
}

/**
 * Creates an in-memory database for testing.
 */
export function openMemoryDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}
