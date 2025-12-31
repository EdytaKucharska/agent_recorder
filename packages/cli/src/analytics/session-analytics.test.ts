/**
 * Tests for session analytics pure functions.
 */

import { describe, it, expect } from "vitest";
import {
  computeSessionSummary,
  formatSummaryText,
  formatStatsText,
  formatConciseSummary,
} from "./session-analytics.js";
import type { BaseEvent } from "@agent-recorder/core";

/** Create a mock event for testing */
function mockEvent(overrides: Partial<BaseEvent> = {}): BaseEvent {
  return {
    id: "test-id",
    sessionId: "session-1",
    parentEventId: null,
    sequence: 1,
    eventType: "tool_call",
    agentRole: "assistant",
    agentName: "claude-code",
    skillName: null,
    toolName: "read_file",
    mcpMethod: "tools/call",
    upstreamKey: null,
    startedAt: "2024-01-01T00:00:00.000Z",
    endedAt: "2024-01-01T00:00:01.000Z",
    status: "success",
    inputJson: "{}",
    outputJson: "{}",
    errorCategory: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeSessionSummary", () => {
  it("computes correct total events", () => {
    const events = [
      mockEvent({ sequence: 1 }),
      mockEvent({ sequence: 2 }),
      mockEvent({ sequence: 3 }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.totalEvents).toBe(3);
  });

  it("counts events by status", () => {
    const events = [
      mockEvent({ sequence: 1, status: "success" }),
      mockEvent({ sequence: 2, status: "success" }),
      mockEvent({
        sequence: 3,
        status: "error",
        errorCategory: "jsonrpc_error",
      }),
      mockEvent({
        sequence: 4,
        status: "timeout",
        errorCategory: "downstream_timeout",
      }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.byStatus["success"]).toBe(2);
    expect(summary.byStatus["error"]).toBe(1);
    expect(summary.byStatus["timeout"]).toBe(1);
    expect(summary.successCount).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.timeoutCount).toBe(1);
  });

  it("counts events by tool name", () => {
    const events = [
      mockEvent({ sequence: 1, toolName: "read_file" }),
      mockEvent({ sequence: 2, toolName: "write_file" }),
      mockEvent({ sequence: 3, toolName: "read_file" }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.byToolName["read_file"]).toBe(2);
    expect(summary.byToolName["write_file"]).toBe(1);
  });

  it("computes error rate correctly", () => {
    const events = [
      mockEvent({ sequence: 1, status: "success" }),
      mockEvent({
        sequence: 2,
        status: "error",
        errorCategory: "jsonrpc_error",
      }),
      mockEvent({
        sequence: 3,
        status: "timeout",
        errorCategory: "downstream_timeout",
      }),
      mockEvent({ sequence: 4, status: "success" }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.errorRate).toBe(0.5); // 2 errors out of 4
  });

  it("computes average duration", () => {
    const events = [
      mockEvent({
        sequence: 1,
        startedAt: "2024-01-01T00:00:00.000Z",
        endedAt: "2024-01-01T00:00:01.000Z", // 1000ms
      }),
      mockEvent({
        sequence: 2,
        startedAt: "2024-01-01T00:00:02.000Z",
        endedAt: "2024-01-01T00:00:05.000Z", // 3000ms
      }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.avgDurationMs).toBe(2000);
    expect(summary.totalDurationMs).toBe(4000);
  });

  it("handles events with no end time", () => {
    const events = [
      mockEvent({
        sequence: 1,
        status: "running",
        startedAt: "2024-01-01T00:00:00.000Z",
        endedAt: null,
      }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.avgDurationMs).toBeNull();
    expect(summary.totalDurationMs).toBe(0);
  });

  it("counts error categories", () => {
    const events = [
      mockEvent({
        sequence: 1,
        status: "error",
        errorCategory: "jsonrpc_error",
      }),
      mockEvent({
        sequence: 2,
        status: "timeout",
        errorCategory: "downstream_timeout",
      }),
      mockEvent({
        sequence: 3,
        status: "error",
        errorCategory: "jsonrpc_error",
      }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.byErrorCategory["jsonrpc_error"]).toBe(2);
    expect(summary.byErrorCategory["downstream_timeout"]).toBe(1);
  });

  it("computes top tools sorted by count", () => {
    const events = [
      mockEvent({ sequence: 1, toolName: "read_file" }),
      mockEvent({ sequence: 2, toolName: "read_file" }),
      mockEvent({ sequence: 3, toolName: "read_file" }),
      mockEvent({ sequence: 4, toolName: "write_file" }),
      mockEvent({ sequence: 5, toolName: "write_file" }),
      mockEvent({ sequence: 6, toolName: "bash" }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.topTools).toHaveLength(3);
    expect(summary.topTools[0]).toEqual({ name: "read_file", count: 3 });
    expect(summary.topTools[1]).toEqual({ name: "write_file", count: 2 });
    expect(summary.topTools[2]).toEqual({ name: "bash", count: 1 });
  });

  it("computes slowest calls", () => {
    const events = [
      mockEvent({
        sequence: 1,
        toolName: "fast_tool",
        startedAt: "2024-01-01T00:00:00.000Z",
        endedAt: "2024-01-01T00:00:00.100Z", // 100ms
      }),
      mockEvent({
        sequence: 2,
        toolName: "slow_tool",
        startedAt: "2024-01-01T00:00:01.000Z",
        endedAt: "2024-01-01T00:00:06.000Z", // 5000ms
      }),
      mockEvent({
        sequence: 3,
        toolName: "medium_tool",
        startedAt: "2024-01-01T00:00:07.000Z",
        endedAt: "2024-01-01T00:00:08.000Z", // 1000ms
      }),
    ];

    const summary = computeSessionSummary(events);

    expect(summary.slowestCalls).toHaveLength(3);
    expect(summary.slowestCalls[0]).toEqual({
      sequence: 2,
      toolName: "slow_tool",
      durationMs: 5000,
    });
    expect(summary.slowestCalls[1]).toEqual({
      sequence: 3,
      toolName: "medium_tool",
      durationMs: 1000,
    });
  });

  it("handles empty events array", () => {
    const summary = computeSessionSummary([]);

    expect(summary.totalEvents).toBe(0);
    expect(summary.errorRate).toBe(0);
    expect(summary.avgDurationMs).toBeNull();
    expect(summary.topTools).toHaveLength(0);
    expect(summary.slowestCalls).toHaveLength(0);
  });
});

describe("formatSummaryText", () => {
  it("formats summary as text", () => {
    const events = [
      mockEvent({ sequence: 1, toolName: "read_file", status: "success" }),
    ];
    const summary = computeSessionSummary(events);

    const text = formatSummaryText(summary);

    expect(text).toContain("Session Summary");
    expect(text).toContain("Total Events: 1");
    expect(text).toContain("read_file: 1");
    expect(text).toContain("success: 1");
  });

  it("includes error categories when present", () => {
    const events = [
      mockEvent({
        sequence: 1,
        status: "error",
        errorCategory: "jsonrpc_error",
      }),
    ];
    const summary = computeSessionSummary(events);

    const text = formatSummaryText(summary);

    expect(text).toContain("Error Categories:");
    expect(text).toContain("jsonrpc_error: 1");
  });
});

describe("formatStatsText", () => {
  it("formats stats output", () => {
    const events = [
      mockEvent({ sequence: 1, toolName: "read_file" }),
      mockEvent({ sequence: 2, toolName: "read_file" }),
    ];
    const summary = computeSessionSummary(events);

    const text = formatStatsText(summary);

    expect(text).toContain("Session Statistics");
    expect(text).toContain("Tool Call Counts");
    expect(text).toContain("read_file");
    expect(text).toContain("Summary:");
    expect(text).toContain("Total Events:");
  });
});

describe("formatConciseSummary", () => {
  it("formats concise one-liner summary", () => {
    const events = [
      mockEvent({ sequence: 1, toolName: "read_file" }),
      mockEvent({ sequence: 2, toolName: "write_file" }),
    ];
    const summary = computeSessionSummary(events);

    const text = formatConciseSummary(events, summary);

    expect(text).toContain("2 tool calls");
    expect(text).toContain("read_file");
  });
});
