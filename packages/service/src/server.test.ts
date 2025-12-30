/**
 * Integration test for the Agent Recorder service.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  openMemoryDatabase,
  runMigrations,
  type EventType,
  type EventStatus,
} from "@agent-recorder/core";
import { createServer } from "./server.js";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("Agent Recorder Service", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeAll(async () => {
    // Create in-memory database
    db = openMemoryDatabase();

    // Run migrations - go from packages/service/src to packages/core/migrations
    const migrationsDir = join(__dirname, "..", "..", "core", "migrations");
    runMigrations(db, migrationsDir);

    // Create server
    app = await createServer({ db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("GET /api/health returns ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    const health = response.json();
    expect(health.status).toBe("ok");
    expect(health).toHaveProperty("pid");
    expect(health).toHaveProperty("uptime");
    expect(health).toHaveProperty("mode");
  });

  it("POST /api/sessions creates a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
    });

    expect(response.statusCode).toBe(201);
    const session = response.json();
    expect(session).toHaveProperty("id");
    expect(session).toHaveProperty("startedAt");
    expect(session.status).toBe("active");
  });

  it("full session lifecycle with events", async () => {
    // Create session
    const createSessionRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
    });
    expect(createSessionRes.statusCode).toBe(201);
    const session = createSessionRes.json();

    // Insert event
    const eventPayload = {
      id: randomUUID(),
      sessionId: session.id,
      parentEventId: null,
      sequence: 1,
      eventType: "agent_call" as EventType,
      agentRole: "assistant",
      agentName: "claude",
      skillName: null,
      startedAt: new Date().toISOString(),
      status: "running" as EventStatus,
    };

    const insertEventRes = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: eventPayload,
    });
    expect(insertEventRes.statusCode).toBe(201);
    const event = insertEventRes.json();
    expect(event.id).toBe(eventPayload.id);
    expect(event.sessionId).toBe(session.id);

    // Get session events
    const getEventsRes = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/events`,
    });
    expect(getEventsRes.statusCode).toBe(200);
    const events = getEventsRes.json();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(event.id);

    // End session
    const endSessionRes = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/end`,
      payload: { status: "completed" },
    });
    expect(endSessionRes.statusCode).toBe(200);
    const endedSession = endSessionRes.json();
    expect(endedSession.status).toBe("completed");
    expect(endedSession.endedAt).toBeTruthy();

    // Get session to verify
    const getSessionRes = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
    });
    expect(getSessionRes.statusCode).toBe(200);
    const fetchedSession = getSessionRes.json();
    expect(fetchedSession.status).toBe("completed");
  });

  it("enforces unique constraint on (session_id, sequence)", async () => {
    // Create session
    const createSessionRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
    });
    const session = createSessionRes.json();

    // Insert first event with sequence 1
    const event1 = {
      id: randomUUID(),
      sessionId: session.id,
      parentEventId: null,
      sequence: 1,
      eventType: "agent_call" as EventType,
      agentRole: "assistant",
      agentName: "claude",
      skillName: null,
      startedAt: new Date().toISOString(),
      status: "success" as EventStatus,
    };

    const res1 = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: event1,
    });
    expect(res1.statusCode).toBe(201);

    // Try to insert second event with same sequence - should fail
    const event2 = {
      id: randomUUID(),
      sessionId: session.id,
      parentEventId: null,
      sequence: 1, // duplicate sequence
      eventType: "tool_call" as EventType,
      agentRole: "assistant",
      agentName: "claude",
      skillName: null,
      startedAt: new Date().toISOString(),
      status: "success" as EventStatus,
    };

    const res2 = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: event2,
    });
    expect(res2.statusCode).toBe(500); // Fails due to unique constraint
  });
});

describe("Agent Recorder Service - Current Session", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = openMemoryDatabase();
    const migrationsDir = join(__dirname, "..", "..", "core", "migrations");
    runMigrations(db, migrationsDir);
  });

  afterAll(() => {
    db.close();
  });

  it("GET /api/sessions/current returns 404 when no currentSessionId", async () => {
    const app = await createServer({ db });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/current",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "No active session" });

    await app.close();
  });

  it("GET /api/sessions/current returns session when currentSessionId is set", async () => {
    // Create a session first
    const appNoSession = await createServer({ db });
    await appNoSession.ready();

    const createRes = await appNoSession.inject({
      method: "POST",
      url: "/api/sessions",
    });
    const session = createRes.json();
    await appNoSession.close();

    // Now create server with currentSessionId
    const app = await createServer({ db, currentSessionId: session.id });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/current",
    });

    expect(response.statusCode).toBe(200);
    const current = response.json();
    expect(current.id).toBe(session.id);
    expect(current.status).toBe("active");
    expect(current.startedAt).toBeTruthy();

    await app.close();
  });
});

describe("Agent Recorder Service - Paginated Events", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let sessionId: string;

  beforeAll(async () => {
    db = openMemoryDatabase();
    const migrationsDir = join(__dirname, "..", "..", "core", "migrations");
    runMigrations(db, migrationsDir);

    app = await createServer({ db });
    await app.ready();

    // Create a session
    const createRes = await app.inject({
      method: "POST",
      url: "/api/sessions",
    });
    sessionId = createRes.json().id;

    // Insert multiple events
    for (let i = 1; i <= 10; i++) {
      await app.inject({
        method: "POST",
        url: "/api/events",
        payload: {
          id: randomUUID(),
          sessionId,
          parentEventId: null,
          sequence: i,
          eventType: "tool_call" as EventType,
          toolName: `tool_${i}`,
          agentRole: "assistant",
          agentName: "claude",
          skillName: null,
          startedAt: new Date().toISOString(),
          status: "success" as EventStatus,
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("GET /api/sessions/:id/events returns all events without params", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/events`,
    });

    expect(response.statusCode).toBe(200);
    const events = response.json();
    expect(events).toHaveLength(10);
  });

  it("GET /api/sessions/:id/events?after=5 returns events after sequence 5", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/events?after=5`,
    });

    expect(response.statusCode).toBe(200);
    const events = response.json();
    expect(events).toHaveLength(5);
    expect(events[0].sequence).toBe(6);
    expect(events[4].sequence).toBe(10);
  });

  it("GET /api/sessions/:id/events?limit=3 returns first 3 events", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/events?limit=3`,
    });

    expect(response.statusCode).toBe(200);
    const events = response.json();
    expect(events).toHaveLength(3);
    expect(events[0].sequence).toBe(1);
    expect(events[2].sequence).toBe(3);
  });

  it("GET /api/sessions/:id/events?after=3&limit=2 returns 2 events after sequence 3", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/events?after=3&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    const events = response.json();
    expect(events).toHaveLength(2);
    expect(events[0].sequence).toBe(4);
    expect(events[1].sequence).toBe(5);
  });

  it("GET /api/sessions/:id/events?after=10 returns empty array", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/events?after=10`,
    });

    expect(response.statusCode).toBe(200);
    const events = response.json();
    expect(events).toHaveLength(0);
  });
});
