-- Add tool_name and mcp_method columns for proper tool call metadata
-- SQLite allows ADD COLUMN without rebuilding table

ALTER TABLE events ADD COLUMN tool_name TEXT;
ALTER TABLE events ADD COLUMN mcp_method TEXT;

-- Indexes for efficient filtering by tool name and MCP method
CREATE INDEX IF NOT EXISTS idx_events_tool_name ON events(tool_name);
CREATE INDEX IF NOT EXISTS idx_events_mcp_method ON events(mcp_method);
