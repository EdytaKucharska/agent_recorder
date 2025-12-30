/**
 * Session analytics - pure functions for computing session metrics.
 * These functions work on BaseEvent[] arrays fetched from the API.
 * No side effects, no I/O - just computation.
 */

import type { BaseEvent, ErrorCategory } from "@agent-recorder/core";

/** Session summary computed from events */
export interface SessionSummary {
  totalEvents: number;
  byStatus: Record<string, number>;
  byEventType: Record<string, number>;
  byToolName: Record<string, number>;
  byErrorCategory: Record<string, number>;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  errorRate: number;
  avgDurationMs: number | null;
  totalDurationMs: number;
  topTools: Array<{ name: string; count: number }>;
  topErrors: Array<{ category: ErrorCategory; count: number }>;
  slowestCalls: Array<{
    sequence: number;
    toolName: string | null;
    durationMs: number;
  }>;
}

/**
 * Compute session summary from events.
 */
export function computeSessionSummary(
  events: BaseEvent[],
  slowestCount = 10
): SessionSummary {
  const byStatus: Record<string, number> = {};
  const byEventType: Record<string, number> = {};
  const byToolName: Record<string, number> = {};
  const byErrorCategory: Record<string, number> = {};

  let successCount = 0;
  let errorCount = 0;
  let timeoutCount = 0;
  let totalDurationMs = 0;
  let durationCount = 0;

  // Collect durations for slowest calls
  const durations: Array<{
    sequence: number;
    toolName: string | null;
    durationMs: number;
  }> = [];

  for (const event of events) {
    // Count by status
    byStatus[event.status] = (byStatus[event.status] ?? 0) + 1;

    // Count by event type
    byEventType[event.eventType] = (byEventType[event.eventType] ?? 0) + 1;

    // Count by tool name
    if (event.toolName) {
      byToolName[event.toolName] = (byToolName[event.toolName] ?? 0) + 1;
    }

    // Count by error category
    if (event.errorCategory) {
      byErrorCategory[event.errorCategory] =
        (byErrorCategory[event.errorCategory] ?? 0) + 1;
    }

    // Count success/error/timeout
    if (event.status === "success") {
      successCount++;
    } else if (event.status === "error") {
      errorCount++;
    } else if (event.status === "timeout") {
      timeoutCount++;
    }

    // Compute duration if both timestamps present
    if (event.startedAt && event.endedAt) {
      const duration =
        new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime();
      totalDurationMs += duration;
      durationCount++;
      durations.push({
        sequence: event.sequence,
        toolName: event.toolName,
        durationMs: duration,
      });
    }
  }

  // Top tools by count
  const topTools = Object.entries(byToolName)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Top errors by count
  const topErrors = Object.entries(byErrorCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, count]) => ({
      category: category as ErrorCategory,
      count,
    }));

  // Slowest calls
  const slowestCalls = durations
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, slowestCount);

  return {
    totalEvents: events.length,
    byStatus,
    byEventType,
    byToolName,
    byErrorCategory,
    successCount,
    errorCount,
    timeoutCount,
    errorRate:
      events.length > 0 ? (errorCount + timeoutCount) / events.length : 0,
    avgDurationMs:
      durationCount > 0 ? Math.round(totalDurationMs / durationCount) : null,
    totalDurationMs,
    topTools,
    topErrors,
    slowestCalls,
  };
}

/**
 * Format summary as human-readable text.
 */
export function formatSummaryText(summary: SessionSummary): string {
  const lines: string[] = [];

  lines.push("Session Summary");
  lines.push("=".repeat(50));
  lines.push(`Total Events: ${summary.totalEvents}`);
  lines.push(
    `Error Rate: ${(summary.errorRate * 100).toFixed(1)}% (${summary.errorCount} errors, ${summary.timeoutCount} timeouts)`
  );
  lines.push(
    `Avg Duration: ${summary.avgDurationMs !== null ? `${summary.avgDurationMs}ms` : "N/A"}`
  );
  lines.push(`Total Duration: ${summary.totalDurationMs}ms`);
  lines.push("");

  // By status
  lines.push("By Status:");
  for (const [status, count] of Object.entries(summary.byStatus)) {
    lines.push(`  ${status}: ${count}`);
  }
  lines.push("");

  // Top tools
  if (summary.topTools.length > 0) {
    lines.push("Top Tools:");
    for (const { name, count } of summary.topTools) {
      lines.push(`  ${name}: ${count}`);
    }
    lines.push("");
  }

  // Error categories
  if (summary.topErrors.length > 0) {
    lines.push("Error Categories:");
    for (const { category, count } of summary.topErrors) {
      lines.push(`  ${category}: ${count}`);
    }
    lines.push("");
  }

  // Slowest calls
  if (summary.slowestCalls.length > 0) {
    lines.push("Slowest Calls:");
    for (const { sequence, toolName, durationMs } of summary.slowestCalls.slice(
      0,
      5
    )) {
      lines.push(`  [${sequence}] ${toolName ?? "-"}: ${durationMs}ms`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a concise one-line safe summary (no content).
 */
export function formatConciseSummary(
  events: BaseEvent[],
  summary: SessionSummary
): string {
  const parts: string[] = [];

  // Total events with top tools
  const toolBreakdown = summary.topTools
    .slice(0, 3)
    .map((t) => `${t.name}(${t.count})`)
    .join(", ");
  parts.push(
    `${summary.totalEvents} tool calls across ${toolBreakdown}${summary.topTools.length > 3 ? "..." : ""}`
  );

  // Errors
  if (summary.errorCount > 0 || summary.timeoutCount > 0) {
    const errorDetails = summary.topErrors
      .map((e) => `${e.category}`)
      .join(", ");
    parts.push(
      `${summary.errorCount + summary.timeoutCount} error(s): ${errorDetails || "unknown"}`
    );
  }

  // Slowest call
  if (summary.slowestCalls.length > 0) {
    const slowest = summary.slowestCalls[0]!;
    parts.push(
      `Slowest: ${slowest.toolName ?? "unknown"} (${slowest.durationMs}ms)`
    );
  }

  // Total wall time
  if (summary.totalDurationMs > 0) {
    const wallTime = (summary.totalDurationMs / 1000).toFixed(1);
    parts.push(`Total time: ${wallTime}s`);
  }

  return parts.join("\n");
}

/**
 * Format stats output for CLI.
 */
export function formatStatsText(summary: SessionSummary): string {
  const lines: string[] = [];

  lines.push("Session Statistics");
  lines.push("=".repeat(50));
  lines.push("");

  // Counts by tool
  lines.push("Tool Call Counts (sorted by frequency):");
  const sortedTools = Object.entries(summary.byToolName).sort(
    ([, a], [, b]) => b - a
  );
  for (const [name, count] of sortedTools) {
    lines.push(`  ${name.padEnd(30)} ${count}`);
  }
  lines.push("");

  // Slowest calls
  if (summary.slowestCalls.length > 0) {
    lines.push("Slowest Calls (top 10):");
    for (const { sequence, toolName, durationMs } of summary.slowestCalls) {
      lines.push(
        `  [${String(sequence).padStart(4)}] ${(toolName ?? "-").padEnd(30)} ${durationMs}ms`
      );
    }
    lines.push("");
  }

  // Error counts by tool
  if (summary.topErrors.length > 0) {
    lines.push("Error Categories:");
    for (const { category, count } of summary.topErrors) {
      lines.push(`  ${category.padEnd(30)} ${count}`);
    }
    lines.push("");
  }

  // Summary stats
  lines.push("Summary:");
  lines.push(`  Total Events:    ${summary.totalEvents}`);
  lines.push(`  Success:         ${summary.successCount}`);
  lines.push(`  Errors:          ${summary.errorCount}`);
  lines.push(`  Timeouts:        ${summary.timeoutCount}`);
  lines.push(
    `  Avg Duration:    ${summary.avgDurationMs !== null ? `${summary.avgDurationMs}ms` : "N/A"}`
  );
  lines.push(`  Total Duration:  ${summary.totalDurationMs}ms`);

  return lines.join("\n");
}
