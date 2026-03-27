/**
 * ar_query_token_usage — Aggregated token usage across sessions with grouping.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { queryTokenUsageAggregated } from "@agent-recorder/core";
import { estimateCost } from "../../pricing/estimator.js";
import { QueryTokenUsageInputSchema } from "../../validation/schemas.js";
import type { McpServerOptions } from "../../server.js";

export function register(
  server: McpServer,
  db: Database.Database,
  _opts: McpServerOptions
): void {
  server.tool(
    "ar_query_token_usage",
    "Query aggregated token usage across sessions, grouped by session, upstream, tool name, or day.",
    QueryTokenUsageInputSchema.shape,
    async (params) => {
      const input = QueryTokenUsageInputSchema.parse(params);

      const rows = queryTokenUsageAggregated(db, {
        groupBy: input.group_by as "session" | "upstream" | "tool" | "day",
        ...(input.since !== undefined ? { since: input.since } : {}),
        ...(input.until !== undefined ? { until: input.until } : {}),
        ...(input.session_id !== undefined
          ? { sessionId: input.session_id }
          : {}),
        ...(input.upstream_key !== undefined
          ? { upstreamKey: input.upstream_key }
          : {}),
        limit: input.limit,
      });

      const enriched = rows.map((row) => {
        const cost = estimateCost(row.totalInputTokens, row.totalOutputTokens);
        return {
          group_key: row.groupKey,
          call_count: row.callCount,
          total_input_tokens: row.totalInputTokens,
          total_output_tokens: row.totalOutputTokens,
          total_tokens: row.totalInputTokens + row.totalOutputTokens,
          error_count: row.errorCount,
          avg_duration_ms: row.avgDurationMs,
          estimated_cost_usd: cost.estimatedTotalCostUsd,
        };
      });

      const totals = enriched.reduce(
        (acc, r) => ({
          call_count: acc.call_count + r.call_count,
          total_input_tokens: acc.total_input_tokens + r.total_input_tokens,
          total_output_tokens: acc.total_output_tokens + r.total_output_tokens,
          total_tokens: acc.total_tokens + r.total_tokens,
          estimated_cost_usd: acc.estimated_cost_usd + r.estimated_cost_usd,
        }),
        {
          call_count: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { group_by: input.group_by, rows: enriched, totals },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
