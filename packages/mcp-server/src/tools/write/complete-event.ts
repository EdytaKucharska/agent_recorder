/**
 * ar_complete_event — Update an in-progress event with completion data.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { getEventById, completeEvent } from "@agent-recorder/core";
import { truncateString, MAX_PREVIEW_LEN } from "../../validation/redaction.js";
import { CompleteEventInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";
import type { EventStatus, ErrorCategory } from "@agent-recorder/types";

export function register(
  server: McpServer,
  db: Database.Database,
  _opts: McpServerOptions
): void {
  server.tool(
    "ar_complete_event",
    "Update an in-progress event with its completion data (status, output, error category, token counts).",
    CompleteEventInputSchema.shape,
    async (params) => {
      const input = CompleteEventInputSchema.parse(params);

      // Cross-session protection: verify event belongs to this session
      const existing = getEventById(db, input.event_id);
      if (!existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "event_not_found",
                event_id: input.event_id,
              }),
            },
          ],
          isError: true,
        };
      }

      if (existing.sessionId !== input.session_id) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "session_mismatch",
                event_id: input.event_id,
                session_id: input.session_id,
              }),
            },
          ],
          isError: true,
        };
      }

      // If already completed (not running), return no-op (idempotent)
      if (existing.status !== "running") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                event_id: input.event_id,
                session_id: input.session_id,
                updated: false,
                already_completed: true,
              }),
            },
          ],
        };
      }

      const outputPreview = input.output_preview
        ? truncateString(input.output_preview, MAX_PREVIEW_LEN)
        : undefined;

      const updated = completeEvent(
        db,
        input.event_id,
        input.status as EventStatus,
        input.ended_at,
        outputPreview,
        (input.error_category as ErrorCategory | undefined) ?? null,
        input.output_tokens ?? null
      );

      if (!updated) {
        // Race condition: event was completed between our check and the update
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                event_id: input.event_id,
                session_id: input.session_id,
                updated: false,
                already_completed: true,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              event_id: input.event_id,
              session_id: input.session_id,
              updated: true,
            }),
          },
        ],
      };
    }
  );
}
