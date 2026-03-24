/**
 * Tests for the token monitoring REST endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openMemoryDatabase,
  runMigrations,
  createSession,
  insertEvent,
  upsertToolSchemaMetric,
} from "@agent-recorder/core";
import { createServer } from "../server.js";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function migrationsDir() {
  return join(__dirname, "..", "..", "..", "core", "migrations");
}

describe("GET /api/sessions/:sessionId/tokens", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let sessionId: string;

  beforeAll(async () => {
    db = openMemoryDatabase();
    runMigrations(db, migrationsDir());
    sessionId = randomUUID();
    createSession(db, sessionId, new Date().toISOString());

    insertEvent(db, {
      id: randomUUID(),
      sessionId,
      sequence: 1,
      eventType: "tool_call",
      agentRole: "main",
      agentName: "claude-code",
      toolName: "execute_sql",
      upstreamKey: "supabase",
      startedAt: new Date().toISOString(),
      status: "success",
      inputTokens: 100,
      outputTokens: 200,
    });

    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "supabase",
      toolName: "execute_sql",
      schemaTokens: 50,
    });

    app = await createServer({ db, contextBudgetTokens: 150000 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("returns 200 with valid token summary shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/tokens`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("sessionId", sessionId);
    expect(body).toHaveProperty("estimatedTotalTokens");
    expect(body).toHaveProperty("budgetTokens", 150000);
    expect(body).toHaveProperty("percentUsed");
    expect(body).toHaveProperty("budgetExceeded", false);
    expect(body).toHaveProperty("byUpstream");
    expect(body).toHaveProperty("byTool");
    expect(body.estimatedTotalTokens).toBe(350); // 100+200 call + 50 schema
  });

  it("byTool contains the recorded tool with correct token counts", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/tokens`,
    });

    const body = res.json();
    const tool = body.byTool.find(
      (t: { toolName: string }) => t.toolName === "execute_sql"
    );
    expect(tool).toBeDefined();
    expect(tool.totalInputTokens).toBe(100);
    expect(tool.totalOutputTokens).toBe(200);
  });

  it("returns empty summary for unknown session", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${randomUUID()}/tokens`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.estimatedTotalTokens).toBe(0);
    expect(body.byTool).toHaveLength(0);
  });
});
