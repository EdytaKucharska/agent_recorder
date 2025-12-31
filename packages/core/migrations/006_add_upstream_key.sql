-- Add upstream_key column for router mode
-- This column tracks which upstream MCP server a tool call was routed to

ALTER TABLE events ADD COLUMN upstream_key TEXT;

-- Index for filtering by upstream
CREATE INDEX IF NOT EXISTS idx_events_upstream_key ON events(upstream_key);
