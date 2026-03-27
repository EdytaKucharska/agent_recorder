/**
 * ar_list_upstreams — List all known upstream MCP servers with activity metrics.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { listUpstreamActivity } from "@agent-recorder/core";
import { ListUpstreamsInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";

export function register(
  server: McpServer,
  db: Database.Database,
  _opts: McpServerOptions
): void {
  server.tool(
    "ar_list_upstreams",
    "List all known upstream MCP servers recorded by Agent Recorder, with activity and error metrics.",
    ListUpstreamsInputSchema.shape,
    async (params) => {
      const input = ListUpstreamsInputSchema.parse(params);
      const rows = listUpstreamActivity(db, input.since);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                upstreams: rows.map((r) => ({
                  upstream_key: r.upstreamKey,
                  call_count: r.callCount,
                  session_count: r.sessionCount,
                  last_seen_at: r.lastSeenAt,
                  total_input_tokens: r.totalInputTokens,
                  total_output_tokens: r.totalOutputTokens,
                  total_tokens: r.totalInputTokens + r.totalOutputTokens,
                  error_rate_percent: r.errorRatePercent,
                })),
                count: rows.length,
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
