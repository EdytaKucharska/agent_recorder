<p align="center">
  <h1 align="center">Agent Recorder</h1>
  <p align="center">
    <strong>Flight recorder for AI coding agents — see every tool call, MCP request, and subagent spawn</strong>
  </p>
  <p align="center">
    <a href="https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml"><img src="https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/agent-recorder"><img src="https://badge.fury.io/js/agent-recorder.svg" alt="npm version"></a>
    <a href="https://github.com/EdytaKucharska/agent_recorder/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://www.npmjs.com/package/agent-recorder"><img src="https://img.shields.io/npm/dm/agent-recorder.svg" alt="npm downloads"></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="Node.js >= 20"></a>
    <a href="https://github.com/EdytaKucharska/agent_recorder/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  </p>
</p>

<br>

> **Ever wondered what your AI agent is actually doing?** Agent Recorder captures every tool call, MCP server interaction, and subagent spawn into a local SQLite database — giving you a full, searchable timeline of agent execution. No prompts captured. No chain-of-thought leaked. Just observable boundaries.

<br>

## The Problem

AI coding agents (Claude Code, Cursor, etc.) call dozens of tools per session — file reads, shell commands, MCP servers, subagents — but there's **no easy way to see what happened** after the fact. Debugging agent behavior means scrolling through terminal output or guessing what went wrong.

**Agent Recorder fixes this.** It sits transparently between your agent and its tools, recording a structured timeline you can search, filter, export, and inspect — without ever capturing sensitive prompts or reasoning.

---

## Highlights

- **Zero-config for Claude Code** — install as a plugin, recording starts automatically
- **Works with any MCP client** — Claude Desktop, Cursor, VS Code via STDIO proxy
- **Hierarchical event tree** — agent → subagent → skill → tool relationships preserved
- **Interactive TUI** — browse sessions and inspect events in your terminal
- **Export anywhere** — JSON, JSONL, HAR (browser devtools), OpenTelemetry (Jaeger/Zipkin)
- **Privacy-first** — no prompts, no chain-of-thought, automatic key redaction
- **100% local** — SQLite + localhost daemon, your data never leaves your machine

---

## Quick Start

### Claude Code Plugin (recommended)

```bash
# In Claude Code:
/plugin install agent-recorder@EdytaKucharska/agent_recorder
```

That's it. The plugin installs a `PostToolUse` hook — every tool call is recorded automatically.

| Command                  | Description                     |
| ------------------------ | ------------------------------- |
| `/agent-recorder:start`  | Start the recording daemon      |
| `/agent-recorder:stop`   | Stop the recording daemon       |
| `/agent-recorder:open`   | Open the TUI to browse sessions |
| `/agent-recorder:status` | Check if daemon is running      |
| `/agent-recorder:export` | Export session to JSON/HAR/OTLP |

### npm

```bash
npm install -g agent-recorder
agent-recorder install          # Configure data directory + Claude Code
agent-recorder start --daemon   # Start recording
agent-recorder hooks install    # Install Claude Code hooks
# Restart Claude Code — tool calls are now recorded!
agent-recorder tui              # Browse recordings
```

### Docker

```bash
docker compose up -d
# or
docker run -d -p 8787:8787 -v agent-recorder-data:/data agent-recorder
```

---

## How It Works

Agent Recorder supports three recording methods depending on your setup:

### 1. Hooks (Claude Code)

Claude Code's native hooks fire on every tool call. Zero overhead, zero config.

```
┌─────────────────┐     PostToolUse hook     ┌─────────────────┐
│   Claude Code   │ ───────────────────────► │ Agent Recorder  │
│                 │                          │    Service      │
│  (any MCP       │     SessionStart/End     │   (localhost)   │
│   transport)    │ ───────────────────────► │                 │
└─────────────────┘                          └─────────────────┘
```

**Captures:** All tool calls (Bash, Read, Write, Edit, Glob, Grep, MCP tools, etc.) with input/output details, MCP server name, method, and truncated I/O summaries.

### 2. STDIO Proxy (Claude Desktop, Cursor, VS Code)

Wraps any stdio-based MCP server to capture JSON-RPC traffic transparently.

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   MCP Client    │ stdin   │ agent-recorder  │ stdin   │   MCP Server    │
│ (Claude Desktop │ ──────► │     -proxy      │ ──────► │  (e.g. github)  │
│  Cursor, etc.)  │ ◄────── │                 │ ◄────── │                 │
└─────────────────┘ stdout  └────────┬────────┘ stdout  └─────────────────┘
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

### 3. Hub/Router Mode

Aggregate multiple MCP servers behind one endpoint. All traffic is recorded and routed.

```bash
agent-recorder upstream add github https://api.github.com/mcp
agent-recorder upstream add tessl https://tessl.io/mcp --header "Authorization: Bearer $TOKEN"
agent-recorder upstream list
```

---

## Terminal UI

Browse sessions and inspect events interactively:

```bash
agent-recorder tui
```

```
┌─ Sessions ──────────────────────────────────────────────────────────┐
│ ID        Status     Events  Last Active  Duration                  │
│ a3f1b2c   active        47  2s ago       12m 34s                   │
│ d8e4f5a   completed    132  1h ago       45m 12s                   │
│ b7c9d1e   completed     23  3h ago        5m 08s                   │
└─────────────────────────────────────────────────────────────────────┘
  ↑/↓ navigate  Enter view  / search  r refresh  q quit

┌─ Events (session a3f1b2c) ──────────────────────────────────────────┐
│ Seq  Type        Name              Server        Duration  Status   │
│   1  tool_call   Read              claude-code      12ms  success   │
│   2  tool_call   search_repos      github          340ms  success   │
│   3  subagent    Explore           claude-code    1.2s    success   │
│   4  tool_call   Bash              claude-code      89ms  success   │
│   5  tool_call   Edit              claude-code      15ms  success   │
└─────────────────────────────────────────────────────────────────────┘
  i input  o output  j raw JSON  Tab filter  f follow  Esc back
```

---

## CLI Reference

<details>
<summary><strong>Service Management</strong></summary>

```bash
agent-recorder start [--daemon]     # Start the recording service
agent-recorder stop [--force]       # Stop the service (--force for SIGKILL)
agent-recorder restart              # Restart the service
agent-recorder status               # Check service status + provider health
agent-recorder logs [--tail 50]     # View daemon logs
```

</details>

<details>
<summary><strong>Hooks (Claude Code)</strong></summary>

```bash
agent-recorder hooks install        # Install hooks into Claude Code
agent-recorder hooks uninstall      # Remove hooks
agent-recorder hooks status         # Show hook installation status
```

</details>

<details>
<summary><strong>Sessions</strong></summary>

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

</details>

<details>
<summary><strong>Export</strong></summary>

```bash
agent-recorder export <id>                    # Export to JSONL (default)
agent-recorder export <id> --format json      # Pretty-printed JSON
agent-recorder export <id> --format har       # HTTP Archive (browser dev tools)
agent-recorder export <id> --format otlp      # OpenTelemetry (Jaeger, Zipkin)
agent-recorder export <id> -o session.har     # Export to file
```

| Format | Use Case                                                      |
| ------ | ------------------------------------------------------------- |
| jsonl  | Streaming, piping to other tools                              |
| json   | Human-readable inspection                                     |
| har    | Import into browser dev tools, Charles Proxy, Postman         |
| otlp   | Send to Jaeger, Zipkin, Grafana Tempo, any OpenTelemetry tool |

</details>

<details>
<summary><strong>Upstream / Provider Management</strong></summary>

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

</details>

<details>
<summary><strong>Configuration & Discovery</strong></summary>

```bash
agent-recorder install                        # Set up data directory + Claude config
agent-recorder doctor                         # Full health check and diagnostics
agent-recorder diagnose mcp                   # Focused MCP proxy diagnostics
agent-recorder discover                       # Find MCP configs across all tools
agent-recorder configure claude               # Configure Claude Code MCP settings
agent-recorder configure wrap [--all]         # Wrap MCP servers with proxy
agent-recorder configure wrap --undo          # Unwrap proxied servers
```

The `discover` command scans six config sources: Claude Code (v2 + legacy), Cursor IDE, VS Code, project-level `.claude/`, project-level `.cursor/`.

</details>

---

## Privacy & Security

| Guarantee                | Detail                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **No prompt capture**    | Only tool call boundaries are recorded                                                         |
| **No reasoning capture** | Chain-of-thought is never stored                                                               |
| **Automatic redaction**  | Keys like `api_key`, `token`, `authorization`, `password`, `secret` are stripped from payloads |
| **Payload truncation**   | Large payloads are truncated to prevent storage bloat                                          |
| **Localhost only**       | Daemon binds to `127.0.0.1`, never `0.0.0.0`                                                   |
| **Opt-in telemetry**     | Anonymous, content-free PostHog analytics — disabled by default                                |
| **Fail-open**            | Recording/telemetry errors never block the MCP proxy                                           |

---

## REST API

All endpoints are localhost-only (`127.0.0.1`).

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

## Configuration

<details>
<summary><strong>Environment Variables</strong></summary>

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
| `AGENT_RECORDER_HOOK_TIMEOUT_MS` | `500`                  | Max wait for hook event delivery |

</details>

---

## Architecture

```
packages/
├── types/          # Portable type definitions (zero deps)
├── core/           # Event model, redaction, SQLite storage
├── service/        # Fastify daemon: MCP proxy + recorder + REST API
├── cli/            # CLI commands + TUI (Ink)
├── hooks/          # Claude Code hook handlers
├── stdio-proxy/    # STDIO proxy for MCP server observability
├── ui/             # React + Vite web UI
└── dist/           # Distribution bundler for npm publishing
```

**Dependency flow:** `types` → `core` → `service` / `hooks` / `stdio-proxy` → `cli` → `dist`

**Tech stack:** TypeScript (strict) · Node.js 20+ · Fastify · SQLite (better-sqlite3) · Commander.js · Ink (TUI) · React + Vite (web UI)

---

## Development

```bash
git clone https://github.com/EdytaKucharska/agent_recorder
cd agent_recorder
pnpm install
pnpm build          # Build all packages
pnpm test           # Run tests
pnpm lint           # Lint
pnpm build:dist     # Build distribution package
pnpm smoke:dist     # Smoke test the distribution
```

### Binaries

| Binary                 | Description                          |
| ---------------------- | ------------------------------------ |
| `agent-recorder`       | Main CLI                             |
| `agent-recorder-hook`  | Hook handler (called by Claude Code) |
| `agent-recorder-proxy` | STDIO proxy wrapper for MCP servers  |

---

## Troubleshooting

<details>
<summary><strong>Hooks not working</strong></summary>

```bash
agent-recorder hooks status     # Check hook installation
agent-recorder doctor           # Full diagnostics
agent-recorder status           # Verify daemon is running
```

If hooks show as null in `~/.claude/settings.json`, reinstall with `agent-recorder hooks install` and restart Claude Code.

</details>

<details>
<summary><strong>No events recorded</strong></summary>

1. Ensure the daemon is running: `agent-recorder status`
2. Restart Claude Code after installing hooks
3. Check logs: `agent-recorder logs --tail 100`
4. Run diagnostics: `agent-recorder doctor`

</details>

<details>
<summary><strong>MCP servers not detected</strong></summary>

```bash
agent-recorder discover --verbose   # Scan all MCP config sources
agent-recorder diagnose mcp         # MCP-specific diagnostics
```

</details>

---

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

```bash
pnpm install && pnpm build && pnpm test   # Verify everything passes before submitting
```

---

## License

[MIT](LICENSE) © Edyta Kucharska

---

## Related

- [Claude Code](https://claude.ai/code) — AI coding assistant
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) — Standard for AI tool integration
- [MCP Observability Constraints](docs/article-mcp-observability-constraints.md) — Technical writeup on MCP observability challenges

---

<p align="center">
  <sub>If Agent Recorder helped you debug an agent session, consider giving it a ⭐</sub>
</p>
