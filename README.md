[![CI](https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml/badge.svg)](https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/agent-recorder.svg)](https://www.npmjs.com/package/agent-recorder)

# Agent Recorder

A **local-first flight recorder** for Claude Code and MCP servers. Captures a persistent, human-readable timeline of tool calls, subagents, and skills — so you can debug, audit, and understand agent behavior.

**No prompts. No chain-of-thought. Just observable execution boundaries.**

---

## Features

- **Record all tool calls** from Claude Code (built-in + MCP)
- **Track MCP server usage** across multiple providers
- **Hierarchical events** showing agent → subagent → skill → tool relationships
- **Terminal UI (TUI)** for interactive session inspection
- **Local-first** — SQLite database, localhost daemon, no cloud sync
- **Privacy-focused** — no prompt capture, no reasoning capture

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

### Option 2: npm Install

```bash
# Install globally
npm install -g agent-recorder

# Start the recording service
agent-recorder start --daemon

# Install hooks into Claude Code
agent-recorder hooks install

# Restart Claude Code to pick up the hooks

# Use Claude Code normally — tool calls are now recorded!

# View recordings
agent-recorder tui
```

---

## Architecture

Agent Recorder supports two recording methods:

### Method 1: Hooks (Claude Code)

Uses Claude Code's native hooks system to capture tool calls directly.

```
┌─────────────────┐     PostToolUse hook     ┌─────────────────┐
│   Claude Code   │ ───────────────────────► │ Agent Recorder  │
│                 │                          │    Service      │
│  (any MCP       │     SessionStart/End     │   (localhost)   │
│   transport)    │ ───────────────────────► │                 │
└─────────────────┘                          └─────────────────┘
```

**Supported:** All Claude Code tool calls (Bash, Read, Write, Edit, Glob, Grep, MCP, etc.)

```bash
agent-recorder hooks install   # Install hooks
agent-recorder hooks status    # Check status
agent-recorder hooks uninstall # Remove hooks
```

### Method 2: STDIO Proxy (Other MCP Clients)

Wraps any stdio-based MCP server to capture JSON-RPC traffic. Works with Claude Desktop, Cursor, VS Code, etc.

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   MCP Client    │ stdin   │ agent-recorder  │ stdin   │   MCP Server    │
│ (Claude Desktop │ ──────► │     -proxy      │ ──────► │  (e.g. github)  │
│  Cursor, etc.)  │ ◄────── │                 │ ◄────── │                 │
└─────────────────┘ stdout  └────────┬────────┘ stdout  └─────────────────┘
                                     │
                                     │ telemetry
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

---

## CLI Commands

### Service Management

```bash
agent-recorder start [--daemon]  # Start the recording service
agent-recorder stop              # Stop the service
agent-recorder status            # Check service status
agent-recorder restart           # Restart the service
```

### Hooks (Claude Code)

```bash
agent-recorder hooks install     # Install hooks into Claude Code
agent-recorder hooks uninstall   # Remove hooks
agent-recorder hooks status      # Show hook installation status
```

### Session Viewing

```bash
agent-recorder tui               # Interactive terminal UI
agent-recorder sessions list     # List all sessions
agent-recorder sessions show <id> # Show session details
agent-recorder sessions current  # Get active session
```

### Export

```bash
agent-recorder export <id>                    # Export to JSONL (default)
agent-recorder export <id> --format json      # Export to JSON
agent-recorder export <id> --format har       # Export to HAR (HTTP Archive)
agent-recorder export <id> --format otlp      # Export to OpenTelemetry
agent-recorder export <id> -o session.har     # Export to file
```

**Export Formats:**

| Format | Description                                          |
| ------ | ---------------------------------------------------- |
| jsonl  | JSON Lines - one object per line                     |
| json   | Pretty-printed JSON with session and events          |
| har    | HTTP Archive - compatible with browser dev tools     |
| otlp   | OpenTelemetry - for observability platforms (Jaeger) |

### Configuration

```bash
agent-recorder install           # Set up data directory
agent-recorder doctor            # Diagnose setup issues
```

---

## Terminal UI (TUI)

The TUI provides an interactive way to explore recorded sessions:

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

| Column   | Description                     |
| -------- | ------------------------------- |
| Time     | Event timestamp                 |
| Name     | Tool/skill/agent name           |
| Server   | MCP server (or "claude-code")   |
| Duration | Execution time                  |
| Status   | success ✓ / error ✗ / running → |

**Keys:** `↑/↓` navigate, `Enter` inspect, `Tab` filter, `f` follow mode, `Esc` back

### Event Details

**Keys:** `i` input JSON, `o` output JSON, `j` raw event, `Esc` close

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

A session represents a single Claude Code run (or MCP client session).

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
  eventType: "agent_call" | "subagent_call" | "skill_call" | "tool_call";
  toolName: string | null;
  upstreamKey: string | null; // MCP server name
  status: "running" | "success" | "error" | "timeout" | "cancelled";
  inputJson: string | null; // Redacted tool arguments
  outputJson: string | null; // Redacted tool result
  startedAt: string;
  endedAt: string | null;
}
```

---

## Privacy & Security

- **Local-first:** All data stored in `~/.agent-recorder/` (SQLite)
- **No cloud sync:** Data never leaves your machine
- **No prompt capture:** Only tool boundaries are recorded
- **No reasoning capture:** Chain-of-thought is not recorded
- **Redaction:** Sensitive keys can be redacted from JSON payloads
- **Opt-in telemetry:** Anonymous, content-free (disabled by default)

---

## Configuration

### Environment Variables

| Variable                   | Default                      | Description                    |
| -------------------------- | ---------------------------- | ------------------------------ |
| `AR_LISTEN_PORT`           | `8787`                       | Service port                   |
| `AR_UI_PORT`               | `8788`                       | Web UI port                    |
| `AR_DB_PATH`               | `~/.agent-recorder/*.sqlite` | Database path                  |
| `AR_REDACT_KEYS`           | (none)                       | Comma-separated keys to redact |
| `AGENT_RECORDER_TELEMETRY` | `off`                        | Telemetry: `on` or `off`       |

---

## Tech Stack

- **Runtime:** Node.js 20+ / TypeScript (strict, ES2022)
- **CLI:** Commander.js
- **Service:** Fastify (localhost only)
- **Database:** SQLite (better-sqlite3)
- **TUI:** Ink (React for CLI)
- **Packaging:** npm with vendored dependencies

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
```

### Monorepo Structure

```
packages/
├── core/        # Types, SQLite, utilities
├── service/     # Fastify daemon + API
├── cli/         # Commander CLI + TUI
├── hooks/       # Claude Code hook handler
├── stdio-proxy/ # STDIO proxy for MCP servers
├── ui/          # React web UI (optional)
└── dist/        # Published npm package
```

---

## Troubleshooting

### Hooks not working

```bash
# Check hook status
agent-recorder hooks status

# Verify service is running
agent-recorder status

# Check logs
agent-recorder logs
```

### No events recorded

1. Ensure the service is running: `agent-recorder status`
2. Restart Claude Code after installing hooks
3. Check `~/.agent-recorder/agent-recorder.log` for errors

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
