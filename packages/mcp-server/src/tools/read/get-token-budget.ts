/**
 * ar_get_token_budget — Return current token budget status for a session.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { getSessionById, getTokenSummary } from "@agent-recorder/core";
import { estimateCost } from "../../pricing/estimator.js";
import { GetTokenBudgetInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";

export function register(
  server: McpServer,
  db: Database.Database,
  opts: McpServerOptions
): void {
  server.tool(
    "ar_get_token_budget",
    "Return the current token budget status for an active session, including percent used and cost estimate.",
    GetTokenBudgetInputSchema.shape,
    async (params) => {
      const input = GetTokenBudgetInputSchema.parse(params);

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

      const budgetTokens = opts.contextBudgetTokens ?? 200_000;
      const summary = getTokenSummary(db, input.session_id, budgetTokens);
      const cost = estimateCost(
        summary.estimatedTotalTokens,
        0 // token summary doesn't split input/output at top level
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                session_id: input.session_id,
                session_status: session.status,
                budget_tokens: summary.budgetTokens,
                used_tokens: summary.estimatedTotalTokens,
                remaining_tokens: Math.max(
                  0,
                  summary.budgetTokens - summary.estimatedTotalTokens
                ),
                percent_used: summary.percentUsed,
                budget_exceeded: summary.budgetExceeded,
                threshold_warning: summary.percentUsed >= 80,
                estimated_cost_usd: cost.estimatedTotalCostUsd,
                by_upstream: summary.byUpstream,
                by_tool: summary.byTool,
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
