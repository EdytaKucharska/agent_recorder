/**
 * Tool call recorder.
 * Records tool_call events to the database with atomic sequence allocation.
 * Implements fail-open pattern: errors are logged but don't block proxy forwarding.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  allocateSequence,
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
  input: unknown;
  output: unknown;
  status: EventStatus;
  startedAt: string;
  endedAt: string;
  redactKeys: string[];
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
    input,
    output,
    status,
    startedAt,
    endedAt,
    redactKeys,
  } = options;

  try {
    // Allocate sequence atomically
    const sequence = allocateSequence(db, sessionId);

    // Redact and truncate input/output
    const inputJson = redactAndTruncate(input, redactKeys);
    const outputJson = redactAndTruncate(output, redactKeys);

    // Generate event ID
    const eventId = randomUUID();

    // Insert event with proper column mapping:
    // - agentName = "claude-code" (stable identifier for the agent)
    // - toolName = actual tool name from params.name
    // - mcpMethod = "tools/call" (or whatever MCP method was invoked)
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
      startedAt,
      endedAt,
      status,
      inputJson,
      outputJson,
    });

    return eventId;
  } catch (error) {
    // Fail-open: log error but don't throw
    console.error("Failed to record tool call:", error);
    return null;
  }
}
