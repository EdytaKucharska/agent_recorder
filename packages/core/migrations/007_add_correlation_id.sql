-- Add correlation_id column for future parallel tool execution support.
-- Currently always NULL; when Claude Code adds correlation IDs,
-- findRunningEvent() will prefer matching on this column.

ALTER TABLE events ADD COLUMN correlation_id TEXT;

-- Index for correlation-based lookups
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
