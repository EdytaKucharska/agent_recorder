-- Add error_category column for stable error classification
-- Categories: downstream_timeout, downstream_unreachable, jsonrpc_invalid, jsonrpc_error, unknown
ALTER TABLE events ADD COLUMN error_category TEXT;

-- Index for filtering by error category
CREATE INDEX IF NOT EXISTS idx_events_error_category ON events(error_category);
