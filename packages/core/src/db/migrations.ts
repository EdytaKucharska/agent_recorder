/**
 * SQLite migrations runner.
 * Reads *.sql files from migrations folder and applies them in order.
 */

import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs all pending migrations from the migrations folder.
 * Creates _migrations tracking table if it doesn't exist.
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string
): void {
  // Create migrations tracking table programmatically
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Get list of applied migrations
  const applied = new Set(
    db
      .prepare("SELECT filename FROM _migrations")
      .all()
      .map((row) => (row as { filename: string }).filename)
  );

  // Read migration files sorted by name
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Apply pending migrations
  for (const filename of files) {
    if (applied.has(filename)) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, filename), "utf-8");

    // Run migration in a transaction
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(filename);
    })();

    console.log(`Applied migration: ${filename}`);
  }
}

/**
 * Gets the default migrations directory path.
 * Assumes this file is at packages/core/src/db/migrations.ts (or dist/db/migrations.js)
 * and migrations are at packages/core/migrations/
 */
export function getDefaultMigrationsDir(): string {
  // ESM-compatible __dirname equivalent
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // When running from dist, we need to go up to packages/core
  // This works for both src and dist locations
  return join(__dirname, "..", "..", "migrations");
}
