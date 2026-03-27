/**
 * ar_list_sessions — List recorded sessions with enriched summary metrics.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { listSessionsSummary } from "@agent-recorder/core";
import { ListSessionsInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";

export function register(
  server: McpServer,
  db: Database.Database,
  _opts: McpServerOptions
): void {
  server.tool(
    "ar_list_sessions",
    "List recorded Agent Recorder sessions with event counts, token totals, and error counts.",
    ListSessionsInputSchema.shape,
    async (params) => {
      const input = ListSessionsInputSchema.parse(params);

      const rows = listSessionsSummary(db, {
        limit: input.limit,
        offset: input.offset,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.since !== undefined ? { since: input.since } : {}),
        ...(input.upstream_key !== undefined
          ? { upstreamKey: input.upstream_key }
          : {}),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                sessions: rows.map((r) => ({
                  session_id: r.id,
                  started_at: r.startedAt,
                  ended_at: r.endedAt,
                  status: r.status,
                  last_activity_at: r.lastActivityAt,
                  event_count: r.eventCount,
                  total_input_tokens: r.totalInputTokens,
                  total_output_tokens: r.totalOutputTokens,
                  total_tokens: r.totalInputTokens + r.totalOutputTokens,
                  error_count: r.errorCount,
                })),
                count: rows.length,
                limit: input.limit,
                offset: input.offset,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
