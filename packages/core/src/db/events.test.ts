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
  getEventsBySession,
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

  describe("upstream_key column", () => {
    it("persists and retrieves upstreamKey correctly", () => {
      const eventWithUpstream = insertEvent(db, {
        id: randomUUID(),
        sessionId,
        sequence: 1,
        eventType: "tool_call",
        agentRole: "assistant",
        agentName: "claude-code",
        toolName: "test-tool",
        mcpMethod: "tools/call",
        upstreamKey: "amplitude",
        startedAt: new Date().toISOString(),
        status: "success",
      });

      expect(eventWithUpstream.upstreamKey).toBe("amplitude");
    });

    it("handles null upstreamKey correctly", () => {
      const eventWithoutUpstream = insertEvent(db, {
        id: randomUUID(),
        sessionId,
        sequence: 2,
        eventType: "tool_call",
        agentRole: "assistant",
        agentName: "claude-code",
        toolName: "test-tool",
        mcpMethod: "tools/call",
        upstreamKey: null,
        startedAt: new Date().toISOString(),
        status: "success",
      });

      expect(eventWithoutUpstream.upstreamKey).toBeNull();
    });
  });

  describe("nested event tree (3+ levels)", () => {
    it("preserves parent-child relationships: agent → subagent → tool", () => {
      // Level 1: agent_call (root)
      const agentEvent = insertEvent(db, {
        ...createEvent(sessionId, 1, "agent_call"),
        parentEventId: null,
      });
      expect(agentEvent.parentEventId).toBeNull();

      // Level 2: subagent_call (child of agent)
      const subagentEvent = insertEvent(db, {
        ...createEvent(sessionId, 2, "subagent_call"),
        parentEventId: agentEvent.id,
      });
      expect(subagentEvent.parentEventId).toBe(agentEvent.id);

      // Level 3: tool_call (child of subagent)
      const toolEvent = insertEvent(db, {
        ...createEvent(sessionId, 3, "tool_call", "Bash"),
        parentEventId: subagentEvent.id,
      });
      expect(toolEvent.parentEventId).toBe(subagentEvent.id);

      // Verify full tree via getEventsBySession
      const allEvents = getEventsBySession(db, sessionId);
      expect(allEvents).toHaveLength(3);

      // Build parent lookup and verify chain
      const byId = new Map(allEvents.map((e) => [e.id, e]));
      const tool = byId.get(toolEvent.id)!;
      const subagent = byId.get(tool.parentEventId!)!;
      const agent = byId.get(subagent.parentEventId!)!;

      expect(agent.eventType).toBe("agent_call");
      expect(agent.parentEventId).toBeNull();
      expect(subagent.eventType).toBe("subagent_call");
      expect(subagent.parentEventId).toBe(agent.id);
      expect(tool.eventType).toBe("tool_call");
      expect(tool.parentEventId).toBe(subagent.id);
    });

    it("handles 4-level nesting: agent → subagent → skill → tool", () => {
      const agent = insertEvent(db, {
        ...createEvent(sessionId, 1, "agent_call"),
        parentEventId: null,
      });
      const subagent = insertEvent(db, {
        ...createEvent(sessionId, 2, "subagent_call"),
        parentEventId: agent.id,
      });
      const skill = insertEvent(db, {
        ...createEvent(sessionId, 3, "skill_call"),
        parentEventId: subagent.id,
        skillName: "commit",
      });
      const tool = insertEvent(db, {
        ...createEvent(sessionId, 4, "tool_call", "Bash"),
        parentEventId: skill.id,
        skillName: "commit",
      });

      // Walk chain from tool to root
      expect(tool.parentEventId).toBe(skill.id);
      expect(skill.parentEventId).toBe(subagent.id);
      expect(subagent.parentEventId).toBe(agent.id);
      expect(agent.parentEventId).toBeNull();
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
