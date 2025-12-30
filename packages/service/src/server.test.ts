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
    expect(response.json()).toEqual({ status: "ok" });
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
