/**
 * Upstream MCP server activity queries.
 */

import type Database from "better-sqlite3";

export interface UpstreamActivityRow {
  upstreamKey: string;
  callCount: number;
  sessionCount: number;
  lastSeenAt: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  errorRatePercent: number;
}

/** List all known upstream MCP servers with activity metrics */
export function listUpstreamActivity(
  db: Database.Database,
  since?: string
): UpstreamActivityRow[] {
  const params: unknown[] = [];
  const where = since
    ? (params.push(since), "WHERE upstream_key IS NOT NULL AND started_at >= ?")
    : "WHERE upstream_key IS NOT NULL";

  const sql = `
    SELECT
      upstream_key,
      COUNT(*) AS call_count,
      COUNT(DISTINCT session_id) AS session_count,
      MAX(started_at) AS last_seen_at,
      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
      ROUND(
        100.0 * SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) / COUNT(*),
        1
      ) AS error_rate_percent
    FROM events
    ${where}
    GROUP BY upstream_key
    ORDER BY last_seen_at DESC
  `;

  const rows = db.prepare(sql).all(...params) as Array<{
    upstream_key: string;
    call_count: number;
    session_count: number;
    last_seen_at: string;
    total_input_tokens: number;
    total_output_tokens: number;
    error_rate_percent: number;
  }>;

  return rows.map((row) => ({
    upstreamKey: row.upstream_key,
    callCount: row.call_count,
    sessionCount: row.session_count,
    lastSeenAt: row.last_seen_at,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    errorRatePercent: row.error_rate_percent,
  }));
}
