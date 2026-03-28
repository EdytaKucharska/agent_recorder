/**
 * ar_record_batch — Record up to 100 events atomically in a single transaction.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  getSessionById,
  createSession,
  insertEvent,
  allocateSequence,
} from "@agent-recorder/core";
import {
  sanitizePayload,
  truncateString,
  MAX_PREVIEW_LEN,
} from "../../validation/redaction.js";
import { RecordBatchInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";
import type {
  EventType,
  EventStatus,
  ErrorCategory,
} from "@agent-recorder/types";

interface BatchResult {
  event_id: string;
  stored: boolean;
  deduplicated: boolean;
  error?: string;
}

export function register(
  server: McpServer,
  db: Database.Database,
  opts: McpServerOptions
): void {
  server.tool(
    "ar_record_batch",
    "Record up to 100 execution events atomically in a single transaction into Agent Recorder.",
    RecordBatchInputSchema.shape,
    async (params) => {
      const input = RecordBatchInputSchema.parse(params);
      const redactKeys = opts.redactKeys ?? [];
      const results: BatchResult[] = [];

      // Pre-flight: collect caller-supplied event IDs and check existence in one query
      const callerIds = input.events
        .map((e) => e.event_id)
        .filter((id): id is string => id !== undefined);

      const existingIds = new Set<string>();
      if (callerIds.length > 0) {
        const placeholders = callerIds.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT id FROM events WHERE id IN (${placeholders}) AND session_id = ?`
          )
          .all(...callerIds, input.session_id) as Array<{ id: string }>;
        for (const row of rows) {
          existingIds.add(row.id);
        }
      }

      const runBatch = db.transaction(() => {
        if (!getSessionById(db, input.session_id)) {
          const firstEvent = input.events[0];
          const startedAt = firstEvent?.started_at ?? new Date().toISOString();
          createSession(db, input.session_id, startedAt);
        }

        for (const event of input.events) {
          const eventId = event.event_id ?? randomUUID();

          if (event.event_id && existingIds.has(event.event_id)) {
            results.push({
              event_id: eventId,
              stored: false,
              deduplicated: true,
            });
            continue;
          }

          const inputPreview = event.input_preview
            ? truncateString(event.input_preview, MAX_PREVIEW_LEN)
            : null;
          const outputPreview = event.output_preview
            ? truncateString(event.output_preview, MAX_PREVIEW_LEN)
            : null;

          const sanitizedMeta = event.metadata
            ? sanitizePayload(event.metadata, redactKeys)
            : null;
          const metadataJson = sanitizedMeta
            ? JSON.stringify(sanitizedMeta)
            : null;

          const sequence = allocateSequence(db, input.session_id);

          insertEvent(db, {
            id: eventId,
            sessionId: input.session_id,
            parentEventId: event.parent_event_id ?? null,
            sequence,
            eventType: event.event_type as EventType,
            agentRole: event.agent_role ?? "external",
            agentName: event.agent_name ?? input.source,
            skillName: event.skill_name ?? null,
            toolName: event.tool_name ?? null,
            mcpMethod: null,
            upstreamKey: event.upstream_key ?? null,
            correlationId: null,
            startedAt: event.started_at,
            endedAt: event.ended_at ?? null,
            status: event.status as EventStatus,
            inputJson: inputPreview ?? metadataJson,
            outputJson: outputPreview,
            errorCategory:
              (event.error_category as ErrorCategory | undefined) ?? null,
            inputTokens: event.input_tokens ?? null,
            outputTokens: event.output_tokens ?? null,
            source: input.source,
            model: event.model ?? null,
          });

          results.push({
            event_id: eventId,
            stored: true,
            deduplicated: false,
          });
        }
      });

      runBatch();

      const storedCount = results.filter((r) => r.stored).length;
      const deduplicatedCount = results.filter((r) => r.deduplicated).length;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: input.session_id,
              stored: storedCount,
              deduplicated: deduplicatedCount,
              total: results.length,
              results,
            }),
          },
        ],
      };
    }
  );
}
