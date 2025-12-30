-- Agent Recorder: Initial Schema
-- Migration: 001_initial
--
-- Creates sessions and events tables with denormalized fields
-- for efficient querying and hierarchical timeline rendering.

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'error')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Events table with denormalized fields
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    parent_event_id TEXT,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('agent_call', 'subagent_call', 'skill_call', 'tool_call')),
    agent_role TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    skill_name TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'timeout', 'cancelled')),
    input_json TEXT,
    output_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_event_id) REFERENCES events(id) ON DELETE SET NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_parent_event_id ON events(parent_event_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_sequence ON events(session_id, sequence);
