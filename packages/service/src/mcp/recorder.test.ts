/**
 * Tests for recordToolCall — budget alerting and token recording.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openMemoryDatabase,
  runMigrations,
  getDefaultMigrationsDir,
  createSession,
  getEventsBySession,
  upsertToolSchemaMetric,
} from "@agent-recorder/core";
import type Database from "better-sqlite3";
import { recordToolCall, resetBudgetWarnedSessions } from "./recorder.js";

describe("recordToolCall — token recording", () => {
  let db: Database.Database;
  let sessionId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    runMigrations(db, getDefaultMigrationsDir());
    sessionId = randomUUID();
    createSession(db, sessionId, new Date().toISOString());
    resetBudgetWarnedSessions();
  });

  afterEach(() => {
    db.close();
  });

  it("records non-null inputTokens and outputTokens", () => {
    recordToolCall({
      db,
      sessionId,
      toolName: "execute_sql",
      input: { query: "SELECT 1" },
      output: { rows: [{ id: 1 }] },
      status: "success",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      redactKeys: [],
    });

    const events = getEventsBySession(db, sessionId);
    const event = events.find((e) => e.toolName === "execute_sql");
    expect(event).toBeDefined();
    expect(event!.inputTokens).not.toBeNull();
    expect(event!.outputTokens).not.toBeNull();
    expect(event!.inputTokens!).toBeGreaterThan(0);
    expect(event!.outputTokens!).toBeGreaterThan(0);
  });
});

describe("recordToolCall — budget alerting", () => {
  let db: Database.Database;
  let sessionId: string;

  beforeEach(() => {
    db = openMemoryDatabase();
    runMigrations(db, getDefaultMigrationsDir());
    sessionId = randomUUID();
    createSession(db, sessionId, new Date().toISOString());
    resetBudgetWarnedSessions();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("emits a budget warning when tokens exceed the threshold", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Large payload to exceed a tiny budget
    recordToolCall({
      db,
      sessionId,
      toolName: "execute_sql",
      input: { query: "x".repeat(500) },
      output: { result: "y".repeat(500) },
      status: "success",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      redactKeys: [],
      contextBudgetTokens: 1, // budget of 1 token — always exceeded
    });

    expect(warnSpy).toHaveBeenCalledOnce();
    const warningArg = warnSpy.mock.calls[0]![0] as string;
    const warning = JSON.parse(warningArg);
    expect(warning.type).toBe("context_budget_warning");
    expect(warning.sessionId).toBe(sessionId);
    expect(warning.estimatedTokens).toBeGreaterThan(0);
  });

  it("only warns once per session, not on every subsequent call", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const opts = {
      db,
      sessionId,
      toolName: "execute_sql",
      input: { query: "x".repeat(500) },
      output: { result: "y".repeat(500) },
      status: "success" as const,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      redactKeys: [],
      contextBudgetTokens: 1,
    };

    recordToolCall(opts);
    recordToolCall(opts);
    recordToolCall(opts);

    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("does not warn when tokens are under budget", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    recordToolCall({
      db,
      sessionId,
      toolName: "Glob",
      input: { pattern: "*.ts" },
      output: { files: [] },
      status: "success",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      redactKeys: [],
      contextBudgetTokens: 150000, // very large budget
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("includes schema tokens in budget check so trigger matches reported value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Seed a large schema metric so schema tokens alone push over the budget
    upsertToolSchemaMetric(db, {
      sessionId,
      upstreamKey: "myserver",
      toolName: "heavy_tool",
      schemaTokens: 9999,
    });

    // Small call payload — call tokens alone won't exceed budget of 5000
    recordToolCall({
      db,
      sessionId,
      toolName: "light_tool",
      input: { x: 1 },
      output: { y: 2 },
      status: "success",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      redactKeys: [],
      contextBudgetTokens: 5000, // exceeded only when schema tokens are included
    });

    // Warning must fire because callTokens + schemaTokens > 5000
    expect(warnSpy).toHaveBeenCalledOnce();
    const warning = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(warning.type).toBe("context_budget_warning");
    // estimatedTokens in the warning must reflect schema tokens too
    expect(warning.estimatedTokens).toBeGreaterThan(5000);
  });
});
