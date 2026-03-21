-- Add correlation_id column for future parallel tool execution support.
-- Currently always NULL — no code path generates or assigns correlation IDs yet.
-- This column is scaffolding for when Claude Code's hook API exposes correlation
-- IDs. At that point, findRunningEvent() will prefer matching on this column
-- over the fallback tool-name-based lookup.
-- See also: findRunningEvent() in packages/core/src/db/events.ts

ALTER TABLE events ADD COLUMN correlation_id TEXT;

-- Index for correlation-based lookups (unused until IDs are generated)
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
