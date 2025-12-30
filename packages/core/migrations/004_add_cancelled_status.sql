-- Agent Recorder: Add 'cancelled' status to sessions
-- Migration: 004_add_cancelled_status
--
-- Adds 'cancelled' to the sessions status CHECK constraint.
-- SQLite doesn't support ALTER CHECK, so we recreate the table.

-- Create new sessions table with updated constraint
CREATE TABLE sessions_new (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'error', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy existing data
INSERT INTO sessions_new SELECT * FROM sessions;

-- Drop old table
DROP TABLE sessions;

-- Rename new table
ALTER TABLE sessions_new RENAME TO sessions;
