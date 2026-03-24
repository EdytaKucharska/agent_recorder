/**
 * Tool call recorder.
 * Records tool_call events to the database with atomic sequence allocation.
 * Implements fail-open pattern: errors are logged but don't block proxy forwarding.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  allocateSequence,
  deriveErrorCategory,
  insertEvent,
  redactAndTruncate,
  getTokenSummary,
  type EventStatus,
} from "@agent-recorder/core";

export interface RecordToolCallOptions {
  db: Database.Database;
  sessionId: string;
  parentEventId?: string | null;
  toolName: string;
  mcpMethod?: string;
  upstreamKey?: string | null;
  input: unknown;
  output: unknown;
  status: EventStatus;
  startedAt: string;
  endedAt: string;
  redactKeys: string[];
  /** Enable debug logging (metadata only, no payloads) */
  debugProxy?: boolean;
  /** Context budget in tokens; warn when session exceeds this */
  contextBudgetTokens?: number;
}

/**
 * Track sessions where a budget warning has already been emitted.
 * Prevents log spam on every tool call after the threshold is crossed.
 * Capped at 10k entries to avoid unbounded memory growth in long-running daemons.
 */
const budgetWarnedSessions = new Set<string>();
const MAX_BUDGET_WARNED_SESSIONS = 10_000;

/**
 * Record a tool call event to the database.
 * Uses atomic sequence allocation from session_sequences table.
 * Fails open: catches errors, logs them, and continues.
 *
 * @returns The event ID if successful, null if recording failed
 */
export function recordToolCall(options: RecordToolCallOptions): string | null {
  const {
    db,
    sessionId,
    parentEventId,
    toolName,
    mcpMethod,
    upstreamKey,
    input,
    output,
    status,
    startedAt,
    endedAt,
    redactKeys,
    debugProxy,
    contextBudgetTokens,
  } = options;

  try {
    const sequence = allocateSequence(db, sessionId);

    const inputJson = redactAndTruncate(input, redactKeys);
    const outputJson = redactAndTruncate(output, redactKeys);
    const errorCategory = deriveErrorCategory(status, outputJson);

    // Estimate tokens from already-serialized strings (length / 4, no re-stringify)
    const inputTokens = Math.ceil(inputJson.length / 4);
    const outputTokens = Math.ceil(outputJson.length / 4);

    const eventId = randomUUID();

    insertEvent(db, {
      id: eventId,
      sessionId,
      parentEventId: parentEventId ?? null,
      sequence,
      eventType: "tool_call",
      agentRole: "assistant",
      agentName: "claude-code",
      skillName: null,
      toolName,
      mcpMethod: mcpMethod ?? "tools/call",
      upstreamKey: upstreamKey ?? null,
      startedAt,
      endedAt,
      status,
      inputJson,
      outputJson,
      errorCategory,
      inputTokens,
      outputTokens,
    });

    // Budget check — fail-open, never throws
    if (contextBudgetTokens) {
      try {
        const summary = getTokenSummary(db, sessionId, contextBudgetTokens);
        if (summary.budgetExceeded && !budgetWarnedSessions.has(sessionId)) {
          if (budgetWarnedSessions.size >= MAX_BUDGET_WARNED_SESSIONS) {
            budgetWarnedSessions.clear();
          }
          budgetWarnedSessions.add(sessionId);
          console.warn(
            JSON.stringify({
              type: "context_budget_warning",
              sessionId,
              estimatedTokens: summary.estimatedTotalTokens,
              budgetTokens: contextBudgetTokens,
              percentUsed: summary.percentUsed,
            })
          );
        }
      } catch {
        // Fail-open
      }
    }

    if (debugProxy) {
      const durationMs =
        new Date(endedAt).getTime() - new Date(startedAt).getTime();
      const upstreamInfo = upstreamKey ? ` upstream=${upstreamKey}` : "";
      console.log(
        `[DEBUG] tool_call: session=${sessionId} seq=${sequence} tool=${toolName}${upstreamInfo} status=${status} duration=${durationMs}ms tokens=${inputTokens}+${outputTokens}`
      );
    }

    return eventId;
  } catch (error) {
    console.error("Failed to record tool call:", error);
    return null;
  }
}
