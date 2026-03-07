# Feature: MCP Server for Agent Recorder (Outbound Observability)

## Context

Agent Recorder currently works as a passive proxy — it intercepts MCP calls
between Claude Code and MCP servers automatically. However, when AI agents
run inside external orchestrators (n8n, LangGraph, CrewAI, Make), those
runtimes manage their own MCP connections and Agent Recorder cannot intercept
them passively.

This feature adds an **MCP server interface** to Agent Recorder, so any MCP
client (including n8n's native AI Agent node) can connect and use Agent
Recorder as an explicit observability tool.

---

## What to build

Add a new command to the Agent Recorder CLI:

```bash
agent-recorder mcp-server --port 8788
```

This starts an MCP server (SSE transport) that exposes the following tools,
backed by the existing Agent Recorder REST API at `http://127.0.0.1:8787`.

---

## MCP Tools to expose

### 1. `check_health`

- No parameters
- Calls `GET /api/health`
- Returns: health status string

### 2. `list_sessions`

- Parameter: `limit: int = 10`
- Calls `GET /api/sessions`
- Returns: JSON array of sessions (id, status, created_at, event_count)

### 3. `get_session_summary`

- Parameter: `session_id: str`
- Calls `GET /api/sessions/:id` + `GET /api/sessions/:id/events`
- Returns: structured summary with:
  - total_events, total_tool_calls
  - tools_used (unique list)
  - error_count + errors (capped at 5)
  - health flag ("✅ Clean" or "❌ Errors detected")

### 4. `get_errors`

- Parameter: `session_id: str`
- Calls `GET /api/sessions/:id/events`
- Filters for error events only
- Returns: list of {tool, message, timestamp, event_type}

### 5. `get_tool_call_stats`

- Parameter: `session_id: str`
- Calls `GET /api/sessions/:id/events`
- Returns: per-tool stats {calls, errors, success_rate}

### 6. `get_latest_session_summary`

- No parameters
- Calls `GET /api/sessions`, sorts by created_at desc, takes first
- Delegates to `get_session_summary` for that session ID

---

## Implementation notes

- Use **FastMCP** (`pip install fastmcp`) — it handles SSE transport cleanly
- Use **httpx** for async HTTP calls to the local REST API
- All tools should handle `ConnectError` gracefully with a clear message:
  `"Agent Recorder daemon not running. Start with: agent-recorder start"`
- Default port: `8788` (avoids conflict with daemon on `8787`)
- Server should bind to `0.0.0.0` so ngrok can tunnel it for cloud clients

---

## File location

Create at:

```
agent_recorder/mcp_server.py
```

And register the CLI command in the existing CLI entry point:

```
agent-recorder mcp-server [--port 8788] [--host 0.0.0.0]
```

---

## Reference implementation

A working standalone prototype is in `agent_recorder_mcp.py` in the repo root.
Use it as the starting point — adapt it to use the existing project structure,
config system, and logging conventions.

---

## Acceptance criteria

- [ ] `agent-recorder mcp-server` starts without error
- [ ] All 6 tools are discoverable by an MCP client
- [ ] `check_health` returns correct status when daemon is running
- [ ] `get_session_summary` returns structured JSON for a real session
- [ ] `get_errors` returns empty/"no errors" correctly for clean sessions
- [ ] Handles daemon-not-running gracefully on all tools
- [ ] Works with ngrok tunnel (binds to 0.0.0.0)
- [ ] Documented in README under "MCP Server" section

---

## Why this matters

This unlocks Agent Recorder as an observability layer for **any** AI agent
runtime, not just Claude Code. n8n, LangGraph, CrewAI and others can connect
to it directly as an MCP tool. It also positions Agent Recorder as the
standard for MCP observability across the ecosystem — not just a Claude Code
plugin.
