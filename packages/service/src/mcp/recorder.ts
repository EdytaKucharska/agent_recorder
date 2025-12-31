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
}

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
  } = options;

  try {
    // Allocate sequence atomically
    const sequence = allocateSequence(db, sessionId);

    // Redact and truncate input/output
    const inputJson = redactAndTruncate(input, redactKeys);
    const outputJson = redactAndTruncate(output, redactKeys);

    // Derive error category from status and redacted output (no content logging)
    const errorCategory = deriveErrorCategory(status, outputJson);

    // Generate event ID
    const eventId = randomUUID();

    // Insert event with proper column mapping:
    // - agentName = "claude-code" (stable identifier for the agent)
    // - toolName = actual tool name from params.name
    // - mcpMethod = "tools/call" (or whatever MCP method was invoked)
    // - upstreamKey = server key from router mode (null for legacy single-upstream)
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
    });

    // Debug logging: metadata only, no payloads
    if (debugProxy) {
      const durationMs =
        new Date(endedAt).getTime() - new Date(startedAt).getTime();
      const upstreamInfo = upstreamKey ? ` upstream=${upstreamKey}` : "";
      console.log(
        `[DEBUG] tool_call: session=${sessionId} seq=${sequence} tool=${toolName}${upstreamInfo} status=${status} duration=${durationMs}ms`
      );
    }

    return eventId;
  } catch (error) {
    // Fail-open: log error but don't throw
    console.error("Failed to record tool call:", error);
    return null;
  }
}
