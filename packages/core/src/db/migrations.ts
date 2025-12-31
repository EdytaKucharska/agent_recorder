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
 * In vendored build: db/migrations.js → ../migrations
 * In dev build: dist/db/migrations.js → ../../migrations
 */
export function getDefaultMigrationsDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Try vendored path first (one level up from db/)
  const vendorPath = join(__dirname, "..", "migrations");
  // Fall back to dev path (two levels up from dist/db/)
  const devPath = join(__dirname, "..", "..", "migrations");

  // Check which path exists
  try {
    readdirSync(vendorPath);
    return vendorPath;
  } catch {
    return devPath;
  }
}
