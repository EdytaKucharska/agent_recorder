-- Add token tracking columns to events table
ALTER TABLE events ADD COLUMN input_tokens INTEGER;
ALTER TABLE events ADD COLUMN output_tokens INTEGER;

-- Tool schema metrics: one row per (session, upstream, tool) from tools/list responses
CREATE TABLE IF NOT EXISTS tool_schema_metrics (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  upstream_key TEXT,
  tool_name    TEXT NOT NULL,
  schema_tokens INTEGER NOT NULL,
  recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tsm_session  ON tool_schema_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_tsm_upstream ON tool_schema_metrics(upstream_key);
