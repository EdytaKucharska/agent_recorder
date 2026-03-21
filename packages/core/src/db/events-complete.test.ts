/**
 * Tests for completeEvent() and findRunningEvent().
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openMemoryDatabase,
  runMigrations,
  getDefaultMigrationsDir,
  insertEvent,
  completeEvent,
  findRunningEvent,
  createSession,
  type InsertEventInput,
} from "../index.js";
import type Database from "better-sqlite3";

function makeEvent(
  sessionId: string,
  sequence: number,
  overrides: Partial<InsertEventInput> = {}
): InsertEventInput {
  return {
    id: randomUUID(),
    sessionId,
    sequence,
    eventType: "tool_call",
    agentRole: "main",
    agentName: "test-agent",
    toolName: "TestTool",
    startedAt: new Date().toISOString(),
    status: "running",
    ...overrides,
  };
}

describe("completeEvent", () => {
  let db: Database.Database;
  let sessionId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    runMigrations(db, getDefaultMigrationsDir());
    sessionId = randomUUID();
    createSession(db, sessionId, new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  it("sets status and endedAt", () => {
    const event = insertEvent(db, makeEvent(sessionId, 1));
    const now = new Date().toISOString();
    const result = completeEvent(db, event.id, "success", now);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("success");
    expect(result!.endedAt).toBe(now);
  });

  it("preserves existing outputJson when outputJson is omitted (undefined)", () => {
    const event = insertEvent(
      db,
      makeEvent(sessionId, 1, {
        outputJson: '{"existing": true}',
        status: "running",
      })
    );

    // Call without outputJson parameter (undefined)
    const result = completeEvent(
      db,
      event.id,
      "success",
      new Date().toISOString()
    );
    expect(result!.outputJson).toBe('{"existing": true}');
  });

  it("clears outputJson when outputJson is explicitly null", () => {
    const event = insertEvent(
      db,
      makeEvent(sessionId, 1, {
        outputJson: '{"existing": true}',
        status: "running",
      })
    );

    const result = completeEvent(
      db,
      event.id,
      "success",
      new Date().toISOString(),
      null
    );
    expect(result!.outputJson).toBeNull();
  });

  it("overwrites outputJson when a string is provided", () => {
    const event = insertEvent(
      db,
      makeEvent(sessionId, 1, {
        outputJson: '{"old": true}',
        status: "running",
      })
    );

    const result = completeEvent(
      db,
      event.id,
      "success",
      new Date().toISOString(),
      '{"new": true}'
    );
    expect(result!.outputJson).toBe('{"new": true}');
  });

  it("sets outputJson from null when a string is provided", () => {
    const event = insertEvent(db, makeEvent(sessionId, 1));
    expect(event.outputJson).toBeNull();

    const result = completeEvent(
      db,
      event.id,
      "success",
      new Date().toISOString(),
      '{"output": 1}'
    );
    expect(result!.outputJson).toBe('{"output": 1}');
  });

  it("returns null for non-existent event ID", () => {
    const result = completeEvent(
      db,
      "non-existent-id",
      "success",
      new Date().toISOString()
    );
    expect(result).toBeNull();
  });

  it("sets error category", () => {
    const event = insertEvent(db, makeEvent(sessionId, 1));
    const result = completeEvent(
      db,
      event.id,
      "error",
      new Date().toISOString(),
      '{"error": "fail"}',
      "tool_error"
    );
    expect(result!.errorCategory).toBe("tool_error");
  });
});

describe("findRunningEvent", () => {
  let db: Database.Database;
  let sessionId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    runMigrations(db, getDefaultMigrationsDir());
    sessionId = randomUUID();
    createSession(db, sessionId, new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  it("returns null when no running events exist", () => {
    const result = findRunningEvent(db, sessionId, "TestTool");
    expect(result).toBeNull();
  });

  it("returns null when events exist but none are running", () => {
    insertEvent(
      db,
      makeEvent(sessionId, 1, { toolName: "TestTool", status: "success" })
    );
    const result = findRunningEvent(db, sessionId, "TestTool");
    expect(result).toBeNull();
  });

  it("finds a running event by tool name", () => {
    const event = insertEvent(
      db,
      makeEvent(sessionId, 1, { toolName: "TestTool", status: "running" })
    );
    const result = findRunningEvent(db, sessionId, "TestTool");
    expect(result).not.toBeNull();
    expect(result!.id).toBe(event.id);
  });

  it("returns the most recent running event when multiple exist", () => {
    insertEvent(
      db,
      makeEvent(sessionId, 1, { toolName: "TestTool", status: "running" })
    );
    const newer = insertEvent(
      db,
      makeEvent(sessionId, 2, { toolName: "TestTool", status: "running" })
    );
    const result = findRunningEvent(db, sessionId, "TestTool");
    expect(result!.id).toBe(newer.id);
  });

  it("does not match events from a different session", () => {
    const otherSession = randomUUID();
    createSession(db, otherSession, new Date().toISOString());
    insertEvent(
      db,
      makeEvent(otherSession, 1, { toolName: "TestTool", status: "running" })
    );

    const result = findRunningEvent(db, sessionId, "TestTool");
    expect(result).toBeNull();
  });

  it("does not match events with a different tool name", () => {
    insertEvent(
      db,
      makeEvent(sessionId, 1, { toolName: "OtherTool", status: "running" })
    );
    const result = findRunningEvent(db, sessionId, "TestTool");
    expect(result).toBeNull();
  });
});
