/**
 * Integration tests for the hooks API endpoint.
 *
 * Tests the full lifecycle: SessionStart → PreToolUse → PostToolUse → SessionEnd,
 * subagent handling, and isToolResponseError edge cases (tested indirectly via
 * PostToolUse status derivation).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  openMemoryDatabase,
  runMigrations,
  getEventsBySession,
  getEventById,
  getSessionById,
} from "@agent-recorder/core";
import { createServer } from "../server.js";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

function migrationsDir() {
  return join(__dirname, "..", "..", "..", "core", "migrations");
}

/** Send a hook event to the test server */
async function sendHook(
  app: FastifyInstance,
  payload: Record<string, unknown>
) {
  return app.inject({
    method: "POST",
    url: "/api/hooks",
    payload,
  });
}

describe("Hooks API — SessionStart → SessionEnd lifecycle", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    db = openMemoryDatabase();
    runMigrations(db, migrationsDir());
    app = await createServer({ db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("creates agent_call on SessionStart and completes on SessionEnd", async () => {
    const sessionId = randomUUID();

    // SessionStart
    const startRes = await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
      start_source: "cli",
    });
    expect(startRes.statusCode).toBe(200);

    // Check that agent_call event was created
    const events = getEventsBySession(db, sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("agent_call");
    expect(events[0]!.status).toBe("running");

    // SessionEnd
    const endRes = await sendHook(app, {
      hook_type: "SessionEnd",
      session_id: sessionId,
      end_reason: "completed",
    });
    expect(endRes.statusCode).toBe(200);

    // Agent call should be completed
    const afterEnd = getEventById(db, events[0]!.id);
    expect(afterEnd!.status).toBe("success");
    expect(afterEnd!.endedAt).toBeTruthy();

    // Session should be completed
    const session = getSessionById(db, sessionId);
    expect(session!.status).toBe("completed");
  });

  it("marks agent_call as error when end_reason is error", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    const events = getEventsBySession(db, sessionId);

    await sendHook(app, {
      hook_type: "SessionEnd",
      session_id: sessionId,
      end_reason: "error",
    });

    const afterEnd = getEventById(db, events[0]!.id);
    expect(afterEnd!.status).toBe("error");

    const session = getSessionById(db, sessionId);
    expect(session!.status).toBe("error");
  });
});

describe("Hooks API — PreToolUse → PostToolUse pairing", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    db = openMemoryDatabase();
    runMigrations(db, migrationsDir());
    app = await createServer({ db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("PreToolUse creates running event, PostToolUse completes it", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    // PreToolUse
    await sendHook(app, {
      hook_type: "PreToolUse",
      session_id: sessionId,
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test.txt" },
    });

    let events = getEventsBySession(db, sessionId);
    const toolEvent = events.find((e) => e.toolName === "Read");
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.status).toBe("running");

    // PostToolUse
    await sendHook(app, {
      hook_type: "PostToolUse",
      session_id: sessionId,
      tool_name: "Read",
      tool_response: { content: "file contents" },
    });

    const completed = getEventById(db, toolEvent!.id);
    expect(completed!.status).toBe("success");
    expect(completed!.endedAt).toBeTruthy();
    expect(completed!.outputJson).toBeTruthy();
  });

  it("PostToolUse without PreToolUse creates standalone event", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    // PostToolUse without prior PreToolUse
    await sendHook(app, {
      hook_type: "PostToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_response: { output: "done" },
    });

    const events = getEventsBySession(db, sessionId);
    const bashEvent = events.find((e) => e.toolName === "Bash");
    expect(bashEvent).toBeDefined();
    expect(bashEvent!.status).toBe("success");
    expect(bashEvent!.endedAt).toBeTruthy();
  });

  it("returns 400 when PreToolUse has no tool_name", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    const res = await sendHook(app, {
      hook_type: "PreToolUse",
      session_id: sessionId,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when PostToolUse has no tool_name", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    const res = await sendHook(app, {
      hook_type: "PostToolUse",
      session_id: sessionId,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Hooks API — isToolResponseError (via PostToolUse status)", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    db = openMemoryDatabase();
    runMigrations(db, migrationsDir());
    app = await createServer({ db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  async function postToolAndGetStatus(toolResponse: unknown): Promise<string> {
    const sessionId = randomUUID();
    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });
    await sendHook(app, {
      hook_type: "PostToolUse",
      session_id: sessionId,
      tool_name: "TestTool",
      tool_response: toolResponse,
    });
    const events = getEventsBySession(db, sessionId);
    const toolEvent = events.find((e) => e.toolName === "TestTool");
    return toolEvent!.status;
  }

  it("treats { isError: true } as error", async () => {
    const status = await postToolAndGetStatus({ isError: true });
    expect(status).toBe("error");
  });

  it("treats { isError: false } as success", async () => {
    const status = await postToolAndGetStatus({ isError: false, result: "ok" });
    expect(status).toBe("success");
  });

  it("treats { error: 'something' } as success (error field is metadata only)", async () => {
    const status = await postToolAndGetStatus({
      error: "something went wrong",
    });
    expect(status).toBe("success");
  });

  it("treats { error: '' } (empty string) as success", async () => {
    const status = await postToolAndGetStatus({ error: "" });
    expect(status).toBe("success");
  });

  it("treats { error: null } as success", async () => {
    const status = await postToolAndGetStatus({ error: null });
    expect(status).toBe("success");
  });

  it("treats { error: { code: 123 } } as success (error field is metadata only)", async () => {
    const status = await postToolAndGetStatus({
      error: { code: 123, message: "fail" },
    });
    expect(status).toBe("success");
  });

  it("treats null response as success", async () => {
    const status = await postToolAndGetStatus(null);
    expect(status).toBe("success");
  });

  it("treats plain string response as success", async () => {
    const status = await postToolAndGetStatus("just a string");
    expect(status).toBe("success");
  });
});

describe("Hooks API — SubagentStop + PostToolUse deduplication", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    db = openMemoryDatabase();
    runMigrations(db, migrationsDir());
    app = await createServer({ db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("SubagentStop + PostToolUse does not create duplicate events", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    // PreToolUse for Agent
    await sendHook(app, {
      hook_type: "PreToolUse",
      session_id: sessionId,
      tool_name: "Agent",
      tool_input: { prompt: "do something" },
    });

    // SubagentStop fires — should only pop parent stack, not complete
    await sendHook(app, {
      hook_type: "SubagentStop",
      session_id: sessionId,
      tool_name: "Agent",
      subagent_type: "general-purpose",
    });

    // PostToolUse fires — should find the running event and complete it
    await sendHook(app, {
      hook_type: "PostToolUse",
      session_id: sessionId,
      tool_name: "Agent",
      tool_response: { result: "done" },
    });

    // Should only have 2 events: agent_call root + one subagent_call (no duplicate)
    const events = getEventsBySession(db, sessionId);
    const subagentEvents = events.filter(
      (e) => e.eventType === "subagent_call"
    );
    expect(subagentEvents).toHaveLength(1);
    expect(subagentEvents[0]!.status).toBe("success");
    expect(subagentEvents[0]!.outputJson).toBeTruthy();
  });

  it("Stop hook defers to SessionEnd for agent_call completion", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    const events = getEventsBySession(db, sessionId);
    const agentCallId = events[0]!.id;

    // Stop fires
    await sendHook(app, {
      hook_type: "Stop",
      session_id: sessionId,
    });

    // Agent call should still be running (Stop defers to SessionEnd)
    const afterStop = getEventById(db, agentCallId);
    expect(afterStop!.status).toBe("running");

    // SessionEnd fires with success
    await sendHook(app, {
      hook_type: "SessionEnd",
      session_id: sessionId,
      end_reason: "completed",
    });

    // Now agent call should be success
    const afterEnd = getEventById(db, agentCallId);
    expect(afterEnd!.status).toBe("success");
  });

  it("marks session and agent_call as cancelled when end_reason is cancelled", async () => {
    const sessionId = randomUUID();

    await sendHook(app, {
      hook_type: "SessionStart",
      session_id: sessionId,
    });

    const events = getEventsBySession(db, sessionId);
    const agentCallId = events[0]!.id;

    await sendHook(app, {
      hook_type: "SessionEnd",
      session_id: sessionId,
      end_reason: "cancelled",
    });

    const afterEnd = getEventById(db, agentCallId);
    expect(afterEnd!.status).toBe("cancelled");

    const session = getSessionById(db, sessionId);
    expect(session!.status).toBe("cancelled");
  });
});
