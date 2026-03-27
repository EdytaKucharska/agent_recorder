/**
 * ar_get_session — Return the full event tree for a session with token roll-up.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { getSessionById, getEventsBySession } from "@agent-recorder/core";
import { buildEventTree, stripIoFromTree } from "../../rollup/token-rollup.js";
import { GetSessionInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";
import type { EventType } from "@agent-recorder/types";

export function register(
  server: McpServer,
  db: Database.Database,
  _opts: McpServerOptions
): void {
  server.tool(
    "ar_get_session",
    "Return the full hierarchical event tree for a session with recursive token roll-up.",
    GetSessionInputSchema.shape,
    async (params) => {
      const input = GetSessionInputSchema.parse(params);

      const session = getSessionById(db, input.session_id);
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "session_not_found",
                session_id: input.session_id,
              }),
            },
          ],
          isError: true,
        };
      }

      const events = getEventsBySession(db, input.session_id);
      const filterTypes = input.event_types as EventType[] | undefined;
      let tree = buildEventTree(events, input.depth, filterTypes);

      if (!input.include_io) {
        tree = stripIoFromTree(tree);
      }

      // Compute top-level totals
      const totalInputTokens = tree.reduce((s, n) => s + n.totalInputTokens, 0);
      const totalOutputTokens = tree.reduce(
        (s, n) => s + n.totalOutputTokens,
        0
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                session: {
                  session_id: session.id,
                  started_at: session.startedAt,
                  ended_at: session.endedAt,
                  status: session.status,
                },
                token_rollup: {
                  total_input_tokens: totalInputTokens,
                  total_output_tokens: totalOutputTokens,
                  total_tokens: totalInputTokens + totalOutputTokens,
                },
                events: tree,
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
