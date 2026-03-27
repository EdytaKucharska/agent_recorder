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

/** A row from cross-session aggregated token queries */
export interface AggregatedTokenRow {
  groupKey: string;
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errorCount: number;
  avgDurationMs: number;
}

/** Query aggregated token usage across sessions, grouped by a dimension */
export function queryTokenUsageAggregated(
  db: Database.Database,
  opts: {
    groupBy: "session" | "upstream" | "tool" | "day";
    since?: string;
    until?: string;
    sessionId?: string;
    upstreamKey?: string;
    limit: number;
  }
): AggregatedTokenRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.since) {
    conditions.push("started_at >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    conditions.push("started_at <= ?");
    params.push(opts.until);
  }
  if (opts.sessionId) {
    conditions.push("session_id = ?");
    params.push(opts.sessionId);
  }
  if (opts.upstreamKey) {
    conditions.push("upstream_key = ?");
    params.push(opts.upstreamKey);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  let groupExpr: string;
  switch (opts.groupBy) {
    case "session":
      groupExpr = "session_id";
      break;
    case "upstream":
      groupExpr = "COALESCE(upstream_key, '(built-in)')";
      break;
    case "tool":
      groupExpr = "COALESCE(tool_name, '(none)')";
      break;
    case "day":
      groupExpr = "DATE(started_at)";
      break;
  }

  params.push(opts.limit);

  const sql = `
    SELECT
      ${groupExpr} AS group_key,
      COUNT(*) AS call_count,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
      COALESCE(
        AVG(
          CASE
            WHEN ended_at IS NOT NULL
            THEN (julianday(ended_at) - julianday(started_at)) * 86400000
            ELSE NULL
          END
        ), 0
      ) AS avg_duration_ms
    FROM events
    ${where}
    GROUP BY ${groupExpr}
    ORDER BY total_input_tokens + total_output_tokens DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params) as Array<{
    group_key: string;
    call_count: number;
    total_input_tokens: number;
    total_output_tokens: number;
    error_count: number;
    avg_duration_ms: number;
  }>;

  return rows.map((row) => ({
    groupKey: row.group_key,
    callCount: row.call_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    errorCount: row.error_count,
    avgDurationMs: Math.round(row.avg_duration_ms),
  }));
}

/** Build a full token summary for a session. */
export function getTokenSummary(
  db: Database.Database,
  sessionId: string,
  budgetTokens: number
): TokenSummary {
  // Per-upstream call tokens.
  // Intentionally filtered to tool_call only: agent_call/subagent_call events
  // don't carry meaningful token payloads in the current schema.
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
