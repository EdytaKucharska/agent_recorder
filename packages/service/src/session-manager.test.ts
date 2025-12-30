/**
 * Tests for session manager.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openMemoryDatabase,
  runMigrations,
  getSessionById,
} from "@agent-recorder/core";
import { createSessionManager } from "./session-manager.js";
import type Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("SessionManager", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDatabase();
    const migrationsDir = join(__dirname, "..", "..", "core", "migrations");
    runMigrations(db, migrationsDir);
  });

  afterEach(() => {
    db.close();
  });

  it("creates active session on construction", () => {
    const manager = createSessionManager(db);

    expect(manager.sessionId).toBeDefined();
    expect(typeof manager.sessionId).toBe("string");
    expect(manager.sessionId.length).toBeGreaterThan(0);

    // Verify session exists in database with active status
    const session = getSessionById(db, manager.sessionId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("active");
    expect(session!.startedAt).toBeDefined();
    expect(session!.endedAt).toBeNull();
  });

  it("ends session with cancelled status by default", () => {
    const manager = createSessionManager(db);
    const sessionId = manager.sessionId;

    manager.shutdown();

    const session = getSessionById(db, sessionId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("cancelled");
    expect(session!.endedAt).not.toBeNull();
  });

  it("ends session with specified status", () => {
    const manager = createSessionManager(db);
    const sessionId = manager.sessionId;

    manager.shutdown("completed");

    const session = getSessionById(db, sessionId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("completed");
    expect(session!.endedAt).not.toBeNull();
  });

  it("ends session with error status when specified", () => {
    const manager = createSessionManager(db);
    const sessionId = manager.sessionId;

    manager.shutdown("error");

    const session = getSessionById(db, sessionId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("error");
    expect(session!.endedAt).not.toBeNull();
  });
});
