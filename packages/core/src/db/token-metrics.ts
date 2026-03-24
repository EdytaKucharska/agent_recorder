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
  db.prepare(`
    INSERT INTO tool_schema_metrics (id, session_id, upstream_key, tool_name, schema_tokens)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(randomUUID(), input.sessionId, input.upstreamKey ?? null, input.toolName, input.schemaTokens);

  // Upsert by (session_id, upstream_key, tool_name) — update schema_tokens if row exists
  db.prepare(`
    UPDATE tool_schema_metrics
    SET schema_tokens = ?, recorded_at = datetime('now')
    WHERE session_id = ?
      AND tool_name = ?
      AND (upstream_key IS ? OR (upstream_key IS NULL AND ? IS NULL))
  `).run(input.schemaTokens, input.sessionId, input.toolName, input.upstreamKey ?? null, input.upstreamKey ?? null);
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
  const upstreamCallRows = db.prepare(`
    SELECT upstream_key, COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS call_tokens
    FROM events
    WHERE session_id = ? AND event_type = 'tool_call'
    GROUP BY upstream_key
  `).all(sessionId) as Array<{ upstream_key: string | null; call_tokens: number }>;

  // Per-upstream schema tokens
  const upstreamSchemaRows = db.prepare(`
    SELECT upstream_key, SUM(schema_tokens) AS schema_tokens
    FROM tool_schema_metrics
    WHERE session_id = ?
    GROUP BY upstream_key
  `).all(sessionId) as Array<{ upstream_key: string | null; schema_tokens: number }>;

  // Per-tool breakdown
  const toolRows = db.prepare(`
    SELECT
      tool_name,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0)  AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens
    FROM events
    WHERE session_id = ? AND event_type = 'tool_call'
    GROUP BY tool_name
    ORDER BY (total_input_tokens + total_output_tokens) DESC
  `).all(sessionId) as Array<{
    tool_name: string;
    calls: number;
    total_input_tokens: number;
    total_output_tokens: number;
  }>;

  // Merge into byUpstream map
  const byUpstream: Record<string, { callTokens: number; schemaTokens: number }> = {};

  for (const row of upstreamCallRows) {
    const key = row.upstream_key ?? "(default)";
    byUpstream[key] = { callTokens: row.call_tokens, schemaTokens: 0 };
  }
  for (const row of upstreamSchemaRows) {
    const key = row.upstream_key ?? "(default)";
    if (!byUpstream[key]) byUpstream[key] = { callTokens: 0, schemaTokens: 0 };
    byUpstream[key]!.schemaTokens = row.schema_tokens;
  }

  const totalCallTokens = Object.values(byUpstream).reduce((s, v) => s + v.callTokens, 0);
  const totalSchemaTokens = Object.values(byUpstream).reduce((s, v) => s + v.schemaTokens, 0);
  const estimatedTotalTokens = totalCallTokens + totalSchemaTokens;
  const percentUsed = Math.round((estimatedTotalTokens / budgetTokens) * 100);

  return {
    sessionId,
    estimatedTotalTokens,
    budgetTokens,
    percentUsed,
    budgetExceeded: estimatedTotalTokens > budgetTokens,
    byUpstream,
    byTool: toolRows.map((r) => ({
      toolName: r.tool_name ?? "",
      calls: r.calls,
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
    })),
  };
}
