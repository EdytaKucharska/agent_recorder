/**
 * Tests for token metrics DB operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openMemoryDatabase,
  runMigrations,
  getDefaultMigrationsDir,
  createSession,
  insertEvent,
  upsertToolSchemaMetric,
  getTokenSummary,
} from "../index.js";
import type Database from "better-sqlite3";

describe("upsertToolSchemaMetric", () => {
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

  it("inserts a new row", () => {
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "github",
      toolName: "search_code",
      schemaTokens: 120,
    });

    const rows = db
      .prepare("SELECT * FROM tool_schema_metrics WHERE session_id = ?")
      .all(sessionId) as Array<{ tool_name: string; schema_tokens: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tool_name).toBe("search_code");
    expect(rows[0]!.schema_tokens).toBe(120);
  });

  it("updates schema_tokens on duplicate (session, upstream, tool)", () => {
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "github",
      toolName: "search_code",
      schemaTokens: 120,
    });
    // Second call with updated count
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "github",
      toolName: "search_code",
      schemaTokens: 200,
    });

    const rows = db
      .prepare("SELECT * FROM tool_schema_metrics WHERE session_id = ?")
      .all(sessionId) as Array<{ schema_tokens: number }>;
    // Must still be exactly one row, not two
    expect(rows).toHaveLength(1);
    expect(rows[0]!.schema_tokens).toBe(200);
  });

  it("treats null upstream_key correctly (no duplicate rows)", () => {
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: null,
      toolName: "Glob",
      schemaTokens: 50,
    });
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: null,
      toolName: "Glob",
      schemaTokens: 60,
    });

    const rows = db
      .prepare(
        "SELECT * FROM tool_schema_metrics WHERE session_id = ? AND tool_name = 'Glob'"
      )
      .all(sessionId);
    expect(rows).toHaveLength(1);
  });

  it("allows same tool name under different upstream keys", () => {
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "github",
      toolName: "search",
      schemaTokens: 100,
    });
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "linear",
      toolName: "search",
      schemaTokens: 80,
    });

    const rows = db
      .prepare("SELECT * FROM tool_schema_metrics WHERE session_id = ?")
      .all(sessionId);
    expect(rows).toHaveLength(2);
  });
});

describe("getTokenSummary", () => {
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

  it("returns zero totals for empty session", () => {
    const summary = getTokenSummary(db, sessionId, 150000);
    expect(summary.estimatedTotalTokens).toBe(0);
    expect(summary.percentUsed).toBe(0);
    expect(summary.budgetExceeded).toBe(false);
    expect(summary.byTool).toHaveLength(0);
  });

  it("does not divide by zero when budgetTokens is 0", () => {
    const summary = getTokenSummary(db, sessionId, 0);
    expect(summary.percentUsed).toBe(0);
    expect(summary.budgetExceeded).toBe(false);
  });

  it("aggregates call tokens from events", () => {
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

    const summary = getTokenSummary(db, sessionId, 150000);
    expect(summary.estimatedTotalTokens).toBe(300);
    expect(summary.byTool).toHaveLength(1);
    expect(summary.byTool[0]!.toolName).toBe("execute_sql");
    expect(summary.byTool[0]!.totalInputTokens).toBe(100);
    expect(summary.byTool[0]!.totalOutputTokens).toBe(200);
  });

  it("includes schema tokens in total", () => {
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "supabase",
      toolName: "execute_sql",
      schemaTokens: 50,
    });

    const summary = getTokenSummary(db, sessionId, 150000);
    expect(summary.estimatedTotalTokens).toBe(50);
    expect(summary.byUpstream["supabase"]!.schemaTokens).toBe(50);
  });

  it("flags budget exceeded when total exceeds budget", () => {
    insertEvent(db, {
      id: randomUUID(),
      sessionId,
      sequence: 1,
      eventType: "tool_call",
      agentRole: "main",
      agentName: "claude-code",
      toolName: "execute_sql",
      startedAt: new Date().toISOString(),
      status: "success",
      inputTokens: 1000,
      outputTokens: 500,
    });

    const summary = getTokenSummary(db, sessionId, 1000);
    expect(summary.budgetExceeded).toBe(true);
    expect(summary.percentUsed).toBeGreaterThan(100);
  });
});
