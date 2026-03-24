/**
 * Token metrics DB operations.
 * Upserts tool schema metrics and queries token summaries per session.
 */

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface UpsertToolSchemaMetricInput {
  sessionId: string;
  upstreamKey: string | null;
  toolName: string;
  schemaTokens: number;
}

/** Upsert a tool schema metric (one row per session+upstream+tool). */
export function upsertToolSchemaMetric(
  db: Database.Database,
  input: UpsertToolSchemaMetricInput
): void {
  // Use ON CONFLICT against the expression-based unique index
  // (session_id, COALESCE(upstream_key, ''), tool_name) to handle NULL upstream_key.
  db.prepare(
    `
    INSERT INTO tool_schema_metrics (id, session_id, upstream_key, tool_name, schema_tokens)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, COALESCE(upstream_key, ''), tool_name) DO UPDATE SET
      schema_tokens = excluded.schema_tokens,
      recorded_at = datetime('now')
  `
  ).run(
    randomUUID(),
    input.sessionId,
    input.upstreamKey ?? null,
    input.toolName,
    input.schemaTokens
  );
}

export interface TokenSummary {
  sessionId: string;
  estimatedTotalTokens: number;
  budgetTokens: number;
  percentUsed: number;
  budgetExceeded: boolean;
  byUpstream: Record<string, { callTokens: number; schemaTokens: number }>;
  byTool: Array<{
    toolName: string;
    calls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }>;
}

/** Build a full token summary for a session. */
export function getTokenSummary(
  db: Database.Database,
  sessionId: string,
  budgetTokens: number
): TokenSummary {
  // Per-upstream call tokens
  const upstreamCallRows = db
    .prepare(
      `
    SELECT upstream_key, COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS call_tokens
    FROM events
    WHERE session_id = ? AND event_type = 'tool_call'
    GROUP BY upstream_key
  `
    )
    .all(sessionId) as Array<{
    upstream_key: string | null;
    call_tokens: number;
  }>;

  // Per-upstream schema tokens
  const upstreamSchemaRows = db
    .prepare(
      `
    SELECT upstream_key, SUM(schema_tokens) AS schema_tokens
    FROM tool_schema_metrics
    WHERE session_id = ?
    GROUP BY upstream_key
  `
    )
    .all(sessionId) as Array<{
    upstream_key: string | null;
    schema_tokens: number;
  }>;

  // Per-tool breakdown
  const toolRows = db
    .prepare(
      `
    SELECT
      tool_name,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0)  AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens
    FROM events
    WHERE session_id = ? AND event_type = 'tool_call'
    GROUP BY tool_name
    ORDER BY (total_input_tokens + total_output_tokens) DESC
  `
    )
    .all(sessionId) as Array<{
    tool_name: string;
    calls: number;
    total_input_tokens: number;
    total_output_tokens: number;
  }>;

  // Merge into byUpstream map
  const byUpstream: Record<
    string,
    { callTokens: number; schemaTokens: number }
  > = {};

  for (const row of upstreamCallRows) {
    const key = row.upstream_key ?? "(built-in)";
    byUpstream[key] = { callTokens: row.call_tokens, schemaTokens: 0 };
  }
  for (const row of upstreamSchemaRows) {
    const key = row.upstream_key ?? "(built-in)";
    if (!byUpstream[key]) byUpstream[key] = { callTokens: 0, schemaTokens: 0 };
    byUpstream[key]!.schemaTokens = row.schema_tokens;
  }

  const totalCallTokens = Object.values(byUpstream).reduce(
    (s, v) => s + v.callTokens,
    0
  );
  const totalSchemaTokens = Object.values(byUpstream).reduce(
    (s, v) => s + v.schemaTokens,
    0
  );
  const estimatedTotalTokens = totalCallTokens + totalSchemaTokens;
  // Guard against divide-by-zero when budget is 0 or not configured
  const percentUsed =
    budgetTokens > 0
      ? Math.round((estimatedTotalTokens / budgetTokens) * 100)
      : 0;

  return {
    sessionId,
    estimatedTotalTokens,
    budgetTokens,
    percentUsed,
    budgetExceeded: budgetTokens > 0 && estimatedTotalTokens > budgetTokens,
    byUpstream,
    byTool: toolRows.map((r) => ({
      toolName: r.tool_name ?? "",
      calls: r.calls,
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
    })),
  };
}
