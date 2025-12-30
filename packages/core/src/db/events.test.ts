/**
 * Tests for event database operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openMemoryDatabase,
  runMigrations,
  getDefaultMigrationsDir,
  insertEvent,
  getLatestToolCallEvent,
  createSession,
  type InsertEventInput,
} from "../index.js";
import type Database from "better-sqlite3";

describe("events", () => {
  let db: Database.Database;
  let sessionId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    runMigrations(db, getDefaultMigrationsDir());

    // Create a session
    sessionId = randomUUID();
    createSession(db, sessionId, new Date().toISOString());
  });

  afterEach(() => {
    db.close();
  });

  describe("getLatestToolCallEvent", () => {
    it("returns null when no tool_call events exist", () => {
      const result = getLatestToolCallEvent(db, sessionId);
      expect(result).toBeNull();
    });

    it("returns null when only other event types exist", () => {
      insertEvent(db, createEvent(sessionId, 1, "agent_call"));

      const result = getLatestToolCallEvent(db, sessionId);
      expect(result).toBeNull();
    });

    it("returns the most recent tool_call event", () => {
      // Insert events in order
      insertEvent(db, createEvent(sessionId, 1, "tool_call", "tool-1"));
      insertEvent(db, createEvent(sessionId, 2, "agent_call"));
      insertEvent(db, createEvent(sessionId, 3, "tool_call", "tool-2"));
      insertEvent(db, createEvent(sessionId, 4, "skill_call"));

      const result = getLatestToolCallEvent(db, sessionId);

      expect(result).not.toBeNull();
      expect(result!.sequence).toBe(3);
      expect(result!.toolName).toBe("tool-2");
    });

    it("returns correct event for specific session", () => {
      // Create another session
      const session2Id = randomUUID();
      createSession(db, session2Id, new Date().toISOString());

      // Insert tool_call in first session
      insertEvent(db, createEvent(sessionId, 1, "tool_call", "session1-tool"));

      // Insert tool_call in second session
      insertEvent(db, createEvent(session2Id, 1, "tool_call", "session2-tool"));

      const result1 = getLatestToolCallEvent(db, sessionId);
      const result2 = getLatestToolCallEvent(db, session2Id);

      expect(result1!.toolName).toBe("session1-tool");
      expect(result2!.toolName).toBe("session2-tool");
    });
  });
});

/**
 * Helper to create a test event input.
 */
function createEvent(
  sessionId: string,
  sequence: number,
  eventType: "agent_call" | "subagent_call" | "skill_call" | "tool_call",
  toolName?: string
): InsertEventInput {
  return {
    id: `event-${sessionId}-${sequence}`,
    sessionId,
    sequence,
    eventType,
    agentRole: "main",
    agentName: "test-agent",
    toolName: toolName ?? null,
    startedAt: new Date().toISOString(),
    status: "success",
  };
}
