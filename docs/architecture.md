# Architecture (Node.js + TypeScript)

## App type (explicit)

Agent Recorder ships as:

1. CLI (terminal control surface)
2. Local daemon/service (MCP proxy + recorder) on localhost
3. Local web UI (read-only inspection) served from localhost

## Data flow

Claude Code -> MCP -> Agent Recorder proxy (records events) -> MCP forwarded unchanged -> downstream MCP servers
UI + CLI talk to daemon via localhost REST API.

## Storage

SQLite local database (better-sqlite3 recommended).
No cloud sync in v1.

## Event model

Hierarchical tree with event types:

- agent_call
- subagent_call
- skill_call
- tool_call

Each event has event_id, parent_event_id, timestamps, agent/subagent context, redacted+truncated I/O, success/error.

## Privacy

No prompt capture, no chain-of-thought.
Telemetry (if enabled) is anonymous and content-free.
