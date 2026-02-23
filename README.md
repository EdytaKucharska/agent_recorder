[![CI](https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml/badge.svg)](https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/agent-recorder.svg)](https://www.npmjs.com/package/agent-recorder)

# Agent Recorder

A **local-first flight recorder** for Claude Code and MCP servers. Captures a persistent, human-readable timeline of tool calls, subagents, and skills — so you can debug, audit, and understand agent behavior.

**No prompts. No chain-of-thought. Just observable execution boundaries.**

---

## Features

- **Claude Code Plugin** — install via `/plugin` and use slash commands directly
- **Record all tool calls** — built-in tools, MCP servers, subagents, skills
- **MCP server tracking** — see which server handled each call, with input/output
- **Hierarchical events** — agent → subagent → skill → tool relationships
- **Terminal UI (TUI)** — interactive session browser with event inspection
- **Multiple export formats** — JSON, JSONL, HAR (browser dev tools), OpenTelemetry (Jaeger)
- **STDIO proxy** — record MCP traffic from Claude Desktop, Cursor, VS Code
- **Docker support** — containerized deployment with persistent storage
- **Hub/Router mode** — aggregate multiple MCP servers behind one endpoint
- **MCP discovery** — auto-detect MCP configs across Claude, Cursor, VS Code
- **Local-first** — SQLite database, localhost daemon, no cloud sync
- **Privacy-focused** — no prompt capture, no reasoning capture, redaction built in

---

## Quick Start

### Option 1: Claude Code Plugin (Recommended)

Install directly in Claude Code using the plugin system:

```bash
# In Claude Code, run:
/plugin install agent-recorder@EdytaKucharska/agent_recorder
```

After installation, use these slash commands:

| Command                  | Description                     |
| ------------------------ | ------------------------------- |
| `/agent-recorder:start`  | Start the recording daemon      |
| `/agent-recorder:stop`   | Stop the recording daemon       |
| `/agent-recorder:open`   | Open the TUI to browse sessions |
| `/agent-recorder:status` | Check if daemon is running      |
| `/agent-recorder:export` | Export session to JSON/HAR/OTLP |

The plugin also installs a `PostToolUse` hook that automatically records every tool call.

### Option 2: npm Install

```bash
# Install globally
npm install -g agent-recorder

# Set up data directory and configure Claude Code
agent-recorder install

# Start the recording daemon
agent-recorder start --daemon

# Install hooks into Claude Code (if not using plugin)
agent-recorder hooks install

# Restart Claude Code to pick up the hooks

# Use Claude Code normally — tool calls are now recorded!

# View recordings
agent-recorder tui
```

### Option 3: Docker

```bash
# Using Docker Compose
docker compose up -d

# Or build and run directly
docker build -t agent-recorder .
docker run -d -p 8787:8787 -v agent-recorder-data:/data agent-recorder
```

---

## Architecture

Agent Recorder supports three recording methods:

### Method 1: Hooks (Claude Code)

Uses Claude Code's native hooks system to capture tool calls directly. Zero config — the plugin installs the hooks automatically.

```
┌─────────────────┐     PostToolUse hook     ┌─────────────────┐
│   Claude Code   │ ───────────────────────► │ Agent Recorder  │
│                 │                          │    Service      │
│  (any MCP       │     SessionStart/End     │   (localhost)   │
│   transport)    │ ───────────────────────► │                 │
└─────────────────┘                          └─────────────────┘
```

**Captures:** All tool calls (Bash, Read, Write, Edit, Glob, Grep, MCP tools, etc.) with input/output details. MCP tool calls are logged with server name, method, and truncated I/O summaries.

### Method 2: STDIO Proxy (Claude Desktop, Cursor, VS Code)

Wraps any stdio-based MCP server to capture JSON-RPC traffic.

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   MCP Client    │ stdin   │ agent-recorder  │ stdin   │   MCP Server    │
│ (Claude Desktop │ ──────► │     -proxy      │ ──────► │  (e.g. github)  │
│  Cursor, etc.)  │ ◄────── │                 │ ◄────── │                 │
└─────────────────┘ stdout  └────────┬────────┘ stdout  └─────────────────┘
                                     │
                                     │ records events
                                     ▼
                            ┌─────────────────┐
                            │ Agent Recorder  │
                            │    Service      │
                            └─────────────────┘
```

**Claude Desktop config example:**

```json
{
  "mcpServers": {
    "github": {
      "command": "agent-recorder-proxy",
      "args": [
        "-e",
        "http://localhost:8787/api/stdio",
        "--",
        "npx",
        "-y",
        "@modelcontextprotocol/server-github"
      ]
    }
  }
}
```

### Method 3: Hub/Router Mode

Aggregate multiple MCP servers behind Agent Recorder. All traffic is recorded and routed to the correct upstream.

```bash
# Add upstream servers
agent-recorder upstream add github https://api.github.com/mcp
agent-recorder upstream add tessl https://tessl.io/mcp --header "Authorization: Bearer $TOKEN"

# List configured upstreams
agent-recorder upstream list
```

---

## CLI Commands

### Service Management

```bash
agent-recorder start [--daemon]     # Start the recording service
agent-recorder stop [--force]       # Stop the service (--force for SIGKILL)
agent-recorder restart              # Restart the service
agent-recorder status               # Check service status + provider health
agent-recorder logs [--tail 50]     # View daemon logs
```

### Hooks (Claude Code)

```bash
agent-recorder hooks install        # Install hooks into Claude Code
agent-recorder hooks uninstall      # Remove hooks
agent-recorder hooks status         # Show hook installation status
```

### Sessions

```bash
agent-recorder tui                  # Interactive terminal UI
agent-recorder sessions list        # List all sessions (--status active/completed/error)
agent-recorder sessions show <id>   # Show session details
agent-recorder sessions current     # Get active session ID
agent-recorder sessions view <id>   # View events with header (--follow, --tail)
agent-recorder sessions tail <id>   # Tail events like tail -f (--interval, -n)
agent-recorder sessions stats <id>  # Event counts, tool distribution
agent-recorder sessions grep <id>   # Search events (--tool, --status, --error, --json)
agent-recorder sessions summarize <id> # Metadata summary (--format text|json)
```

### Export

```bash
agent-recorder export <id>                    # Export to JSONL (default)
agent-recorder export <id> --format json      # Pretty-printed JSON
agent-recorder export <id> --format har       # HTTP Archive (browser dev tools)
agent-recorder export <id> --format otlp      # OpenTelemetry (Jaeger, Zipkin)
agent-recorder export <id> -o session.har     # Export to file
```

**Export Formats:**

| Format | Use Case                                                      |
| ------ | ------------------------------------------------------------- |
| jsonl  | Streaming, piping to other tools                              |
| json   | Human-readable inspection                                     |
| har    | Import into browser dev tools, Charles Proxy, Postman         |
| otlp   | Send to Jaeger, Zipkin, Grafana Tempo, any OpenTelemetry tool |

### Upstream / Provider Management

```bash
agent-recorder upstream add <name> <url>      # Add upstream MCP server
agent-recorder upstream add <name> <url> \
  --header "Authorization: Bearer $TOKEN"     # With auth headers
agent-recorder upstream remove <name>         # Remove upstream
agent-recorder upstream list                  # List all upstreams

agent-recorder add <name> <url>               # Add MCP provider (hub mode)
agent-recorder remove <name>                  # Remove provider
agent-recorder list                           # List providers
```

### Configuration & Setup

```bash
agent-recorder install                        # Set up data directory + Claude config
agent-recorder doctor                         # Full health check and diagnostics
agent-recorder diagnose mcp                   # Focused MCP proxy diagnostics
agent-recorder discover                       # Find MCP configs across all tools
agent-recorder configure claude               # Configure Claude Code MCP settings
agent-recorder configure wrap [--all]         # Wrap MCP servers with proxy
agent-recorder configure wrap --undo          # Unwrap proxied servers
```

### Discovery

The `discover` command scans six configuration sources:

```bash
agent-recorder discover --verbose
```

Sources scanned: Claude Code (v2 + legacy), Cursor IDE, VS Code, project-level `.claude/`, project-level `.cursor/`

### Testing

```bash
agent-recorder mock-mcp [--port 9999]         # Start mock MCP server for testing
```

---

## Terminal UI (TUI)

```bash
agent-recorder tui
```

### Sessions Screen

| Column      | Description                            |
| ----------- | -------------------------------------- |
| ID          | Session UUID (truncated)               |
| Status      | active / completed / cancelled / error |
| Events      | Number of recorded events              |
| Last Active | Time since last event                  |
| Duration    | Total session duration                 |

**Keys:** `↑/↓` navigate, `Enter` view, `/` search, `r` refresh, `q` quit

### Events Screen

| Column   | Description                   |
| -------- | ----------------------------- |
| Seq      | Event sequence number         |
| Type     | tool_call / subagent / skill  |
| Name     | Tool/skill/agent name         |
| Server   | MCP server (or "claude-code") |
| Duration | Execution time                |
| Status   | success / error / running     |

**Keys:** `↑/↓` navigate, `Enter` inspect, `Tab` filter, `f` follow mode, `Esc` back

### Event Inspector

View full details of any recorded event:

- **`i`** — Input JSON (tool arguments)
- **`o`** — Output JSON (tool response)
- **`j`** — Raw event JSON (all metadata)
- **`Esc`** — Close inspector

---

## MCP Logging

When MCP tools are used, the daemon logs detailed summaries:

```
[hooks] [tessl] update_skills
  Input:  {"repository":"skills-repo","branch":"main"}
  Output: {"updated":3,"created":2}

[hooks] [github] search_repositories
  Input:  {"query":"agent recorder","per_page":5}
  Output: {"total_count":12,"items":[{"full_name":"EdytaKucharska/agent_recor...
```

Built-in tools (Bash, Read, Write, etc.) are recorded silently unless debug mode is enabled.

---

## Docker

### Docker Compose (recommended)

```yaml
# docker-compose.yml
services:
  agent-recorder:
    build: .
    ports:
      - "8787:8787"
    volumes:
      - agent-recorder-data:/data
    restart: unless-stopped
```

```bash
docker compose up -d
```

### Docker Build

```bash
docker build -t agent-recorder .
docker run -d \
  -p 8787:8787 \
  -v agent-recorder-data:/data \
  -e AR_LISTEN_PORT=8787 \
  -e AR_DB_PATH=/data/agent-recorder.sqlite \
  agent-recorder
```

The image includes a health check at `GET /api/health`.

---

## REST API

All endpoints are localhost-only (`127.0.0.1`).

### Sessions

| Method | Endpoint                                    | Description         |
| ------ | ------------------------------------------- | ------------------- |
| GET    | `/api/sessions`                             | List sessions       |
| POST   | `/api/sessions`                             | Create session      |
| GET    | `/api/sessions/current`                     | Active session      |
| GET    | `/api/sessions/:id`                         | Session details     |
| POST   | `/api/sessions/:id/end`                     | End session         |
| GET    | `/api/sessions/:id/events`                  | List events         |
| GET    | `/api/sessions/:id/events/count`            | Event count         |
| GET    | `/api/sessions/:id/events/latest-tool-call` | Latest tool call    |
| POST   | `/api/events`                               | Insert event        |
| POST   | `/api/hooks`                                | Receive hook events |
| GET    | `/api/health`                               | Daemon health       |

---

## Binaries

The npm package includes three binaries:

| Binary                 | Description                          |
| ---------------------- | ------------------------------------ |
| `agent-recorder`       | Main CLI                             |
| `agent-recorder-hook`  | Hook handler (called by Claude Code) |
| `agent-recorder-proxy` | STDIO proxy wrapper for MCP servers  |

---

## Data Model

### Sessions

```typescript
interface Session {
  id: string; // UUID
  status: "active" | "completed" | "cancelled" | "error";
  startedAt: string; // ISO 8601
  endedAt: string | null;
}
```

### Events

Events form a hierarchy: agent → subagent → skill → tool

```typescript
interface Event {
  id: string;
  sessionId: string;
  parentEventId: string | null;
  sequence: number; // Per-session ordering
  eventType: "agent_call" | "subagent_call" | "skill_call" | "tool_call";
  toolName: string | null;
  mcpMethod: string | null; // e.g. "tools/call"
  upstreamKey: string | null; // MCP server name
  status: "running" | "success" | "error" | "timeout" | "cancelled";
  errorCategory: string | null; // Stable category enum
  inputJson: string | null; // Redacted tool arguments
  outputJson: string | null; // Redacted tool result
  startedAt: string;
  endedAt: string | null;
}
```

### Error Categories

Errors are mapped to stable categories for filtering:

- `downstream_timeout` — MCP server timed out
- `downstream_unreachable` — MCP server not reachable
- `jsonrpc_invalid` — Malformed JSON-RPC request
- `jsonrpc_error` — JSON-RPC error response
- `unknown` — Unclassified error

---

## Privacy & Security

- **Local-first:** All data stored in `~/.agent-recorder/` (SQLite)
- **No cloud sync:** Data never leaves your machine
- **No prompt capture:** Only tool call boundaries are recorded
- **No reasoning capture:** Chain-of-thought is not stored
- **Redaction:** Sensitive keys (`api_key`, `token`, `authorization`, `password`, `secret`) are automatically redacted from JSON payloads
- **Truncation:** Large payloads are truncated to prevent storage bloat
- **Localhost only:** Daemon binds to `127.0.0.1`, not `0.0.0.0`
- **Opt-in telemetry:** Anonymous, content-free PostHog analytics (disabled by default)
- **Fail-open:** Recording/telemetry errors never block the MCP proxy

---

## Configuration

### Environment Variables

| Variable                   | Default                      | Description                    |
| -------------------------- | ---------------------------- | ------------------------------ |
| `AR_LISTEN_PORT`           | `8787`                       | REST API / hooks port          |
| `AR_MCP_PROXY_PORT`        | `8788`                       | MCP proxy port                 |
| `AR_UI_PORT`               | `8789`                       | Web UI port (reserved)         |
| `AR_DB_PATH`               | `~/.agent-recorder/*.sqlite` | SQLite database path           |
| `AR_DOWNSTREAM_MCP_URL`    | (none)                       | Upstream MCP server (legacy)   |
| `AR_REDACT_KEYS`           | (none)                       | Comma-separated keys to redact |
| `AR_DEBUG_PROXY`           | `0`                          | Enable proxy debug logging     |
| `AGENT_RECORDER_TELEMETRY` | `off`                        | Telemetry: `on` or `off`       |

---

## Tech Stack

- **Runtime:** Node.js 20+ / TypeScript (strict, ES2022)
- **CLI:** Commander.js
- **Service:** Fastify (localhost only)
- **Database:** SQLite (better-sqlite3)
- **TUI:** Ink (React for CLI)
- **Docker:** Node.js 20 Alpine, multi-stage build
- **Packaging:** npm with vendored monorepo dependencies

---

## Development

```bash
# Clone and install
git clone https://github.com/EdytaKucharska/agent_recorder
cd agent_recorder
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linter
pnpm lint

# Build distribution package
pnpm build:dist

# Smoke test the distribution
pnpm smoke:dist

# Test plugin locally
claude --plugin-dir .
```

### Monorepo Structure

```
.claude-plugin/        # Claude Code plugin manifest
commands/              # Plugin slash commands
hooks/                 # Plugin hooks configuration
packages/
├── core/              # Types, SQLite, utilities
├── service/           # Fastify daemon + MCP proxy + REST API
├── cli/               # Commander CLI + TUI (Ink)
├── hooks/             # Claude Code hook handler
├── stdio-proxy/       # STDIO proxy for MCP servers
├── ui/                # React + Vite web UI (reserved)
└── dist/              # Published npm package
```

---

## Troubleshooting

### Hooks not working

```bash
agent-recorder hooks status     # Check hook installation
agent-recorder doctor           # Full diagnostics
agent-recorder status           # Verify daemon is running
```

If hooks show as null in `~/.claude/settings.json`, reinstall:

```bash
agent-recorder hooks install
# Then restart Claude Code
```

### No events recorded

1. Ensure the daemon is running: `agent-recorder status`
2. Restart Claude Code after installing hooks
3. Check logs: `agent-recorder logs --tail 100`
4. Run diagnostics: `agent-recorder doctor`

### MCP servers not detected

```bash
agent-recorder discover --verbose   # Scan all MCP config sources
agent-recorder diagnose mcp         # MCP-specific diagnostics
```

### TUI crashes

Ensure your terminal supports 256 colors and Unicode.

---

## License

MIT

---

## Related

- [Claude Code](https://claude.ai/code) — AI coding assistant
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) — Standard for AI tool integration
- [docs/article-mcp-observability-constraints.md](docs/article-mcp-observability-constraints.md) — Technical writeup on MCP observability challenges
