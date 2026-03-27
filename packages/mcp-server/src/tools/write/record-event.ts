/**
 * ar_record_event — Record a single execution event from an external agent runtime.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  getSessionById,
  createSession,
  insertEvent,
  getEventById,
  allocateSequence,
} from "@agent-recorder/core";
import { truncateString } from "../../validation/redaction.js";
import { RecordEventInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";
import type {
  EventType,
  EventStatus,
  ErrorCategory,
} from "@agent-recorder/types";

const MAX_PREVIEW_LEN = 2048;

export function register(
  server: McpServer,
  db: Database.Database,
  _opts: McpServerOptions
): void {
  server.tool(
    "ar_record_event",
    "Record a single execution event into Agent Recorder's timeline from an external agent runtime.",
    RecordEventInputSchema.shape,
    async (params) => {
      const input = RecordEventInputSchema.parse(params);

      // Idempotency: if event_id already exists in this session, return deduplicated
      if (input.event_id) {
        const existing = getEventById(db, input.event_id);
        if (existing && existing.sessionId === input.session_id) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  event_id: input.event_id,
                  session_id: input.session_id,
                  stored: false,
                  deduplicated: true,
                }),
              },
            ],
          };
        }
      }

      // Auto-create session if it doesn't exist
      if (!getSessionById(db, input.session_id)) {
        createSession(db, input.session_id, input.started_at);
      }

      // Sanitize preview fields
      const inputPreview = input.input_preview
        ? truncateString(input.input_preview, MAX_PREVIEW_LEN)
        : null;
      const outputPreview = input.output_preview
        ? truncateString(input.output_preview, MAX_PREVIEW_LEN)
        : null;

      const eventId = input.event_id ?? randomUUID();
      const sequence = allocateSequence(db, input.session_id);

      insertEvent(db, {
        id: eventId,
        sessionId: input.session_id,
        parentEventId: input.parent_event_id ?? null,
        sequence,
        eventType: input.event_type as EventType,
        agentRole: input.agent_role ?? "external",
        agentName: input.agent_name ?? input.source,
        skillName: input.skill_name ?? null,
        toolName: input.tool_name ?? null,
        mcpMethod: null,
        upstreamKey: input.upstream_key ?? null,
        correlationId: null,
        startedAt: input.started_at,
        endedAt: input.ended_at ?? null,
        status: input.status as EventStatus,
        inputJson: inputPreview,
        outputJson: outputPreview,
        errorCategory:
          (input.error_category as ErrorCategory | undefined) ?? null,
        inputTokens: input.input_tokens ?? null,
        outputTokens: input.output_tokens ?? null,
        source: input.source,
        model: input.model ?? null,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              event_id: eventId,
              session_id: input.session_id,
              stored: true,
              deduplicated: false,
            }),
          },
        ],
      };
    }
  );
}
