# Architecture

## Packages

```
types (zero deps)
  └→ core (SQLite, redaction, config, utilities)
       ├→ service (Fastify daemon: MCP proxy + REST API + hook/stdio receivers)
       ├→ hooks (Claude Code hook handler script)
       └→ stdio-proxy (STDIO proxy for command-based MCP servers)
            └→ cli (Commander.js + Ink TUI)
                 └→ dist (npm distribution bundler)

ui (React + Vite SPA, depends only on types)
```

## Data Flow

Three observation paths, all writing to the same SQLite database:

### 1. Hook Events (primary)

Claude Code fires lifecycle hooks → `agent-recorder-hook` script reads from stdin → `POST /api/hooks` → daemon builds hierarchical event tree.

Hook types: `SessionStart`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionEnd`, `Stop`.

The daemon maintains a per-session `parentStack` to track nesting (agent → subagent → skill → tool).

### 2. HTTP MCP Proxy

Claude Code sends MCP requests → `POST /` on proxy port → daemon forwards to upstream MCP server → records `tool_call` events from the response.

Three routing modes:

- **Hub** — aggregates multiple providers, namespaces tool names
- **Router** — maps `?upstream=key` to URLs from `upstreams.json`
- **Legacy** — single downstream URL

### 3. STDIO Proxy

For command-based MCP servers. Wraps the server process, intercepts stdin/stdout line-by-line, records messages, forwards unchanged. Posts telemetry to `POST /api/stdio`.

## REST API

All endpoints on localhost only. Key routes:

- `GET /api/health` — daemon status, PID, uptime
- `GET /api/sessions` — list sessions (optional `?status=` filter)
- `GET /api/sessions/:id/events` — paginated events (`?after=`, `?limit=`)
- `GET /api/sessions/:id/events/count` — event count
- `POST /api/hooks` — receive hook events
- `POST /api/stdio` — receive STDIO proxy telemetry

## Storage

SQLite via `better-sqlite3` (synchronous API). Single file at `~/.agent-recorder/agent-recorder.sqlite`.

Schema managed by numbered SQL migrations (`packages/core/migrations/`).

## Event Model

Hierarchical tree (not a flat list):

```
agent_call
  ├→ tool_call
  ├→ subagent_call
  │    ├→ tool_call
  │    └→ skill_call
  │         └→ tool_call
  └→ skill_call
       └→ tool_call
```

Each event has: `id`, `session_id`, `parent_event_id`, `sequence`, `event_type`, `status`, `tool_name`, `upstream_key`, `error_category`, `correlation_id`, timestamps, redacted+truncated I/O.

## Privacy

- No prompt capture, no chain-of-thought.
- All I/O redacted (`AR_REDACT_KEYS`) and truncated before storage.
- Telemetry (if enabled) is anonymous and content-free.
- Proxy never blocked on recording — fail open.

## Consumers

- **Web UI** — React SPA served locally, reads via REST API
- **CLI TUI** — Ink-based terminal UI, polls REST API for live updates
- **CLI commands** — direct SQLite access for export/stats/grep
