# Agent Recorder

> A local-first flight recorder for Claude Code.

Agent Recorder captures a **persistent, human-readable timeline** of what Claude Code actually executed — including **subagents**, **skills**, and **MCP tool calls** — so developers can debug, audit, and trust agent behavior.

Agent Recorder is designed to be **calm infrastructure**, not a chatbot.

---

## What it is (explicit)

Agent Recorder is a **Node.js + TypeScript** project that ships as:

- a **CLI** (terminal control surface)
- a **local service/daemon** (MCP proxy + recorder, localhost only)
- a **local web UI** (inspection, read-only)

---

## Why Claude Code users install it

Claude Code is powerful — but execution can be opaque.

When you use:

- subagents
- skills
- tool-heavy workflows

it becomes hard to answer:

- Which subagent actually did the work?
- Were my skills used at all?
- Which tools ran, with what timing, and what failed?
- Where did the time go during a run?

Agent Recorder makes Claude Code execution **explicit and inspectable**.

---

## Quick Start

```bash
# Install from npm
npm install -g agent-recorder

# Set up data directory (~/.agent-recorder/)
agent-recorder install

# Wrap all existing MCP servers with Agent Recorder
agent-recorder configure wrap --all

# Start the daemon
agent-recorder start --daemon
```

Restart Claude Code, and Agent Recorder will now record all MCP tool calls from your URL-based servers.

Monitor your session:

```bash
agent-recorder sessions current         # Get active session ID
agent-recorder sessions view <id>       # View events with header summary
agent-recorder sessions stats <id>      # Show statistics
agent-recorder sessions grep <id> --status error  # Filter errors
agent-recorder sessions summarize <id>  # Safe metadata-only summary
agent-recorder export <id>              # Export to JSONL
```

See `docs/bootstrap.md` for full documentation.

---

## What it does (v1)

- Runs locally as a **transparent MCP proxy**
- Records Claude Code execution into **sessions** with **hierarchical events**
- Attributes tool calls to **main agent / subagent / skill**
- Highlights:
  - **no-op subagents**
  - **unused skills**
  - **timeouts and failures**
- Stores data **locally** (SQLite)
- Provides a **local web UI** for inspection
- Provides a **CLI** for control (start/stop/session/open)
- Optional, **opt-in** PostHog telemetry (content-free)

---

## MCP Server Support

Agent Recorder works by proxying MCP traffic. It supports different server types:

| Server Type | Support | Notes |
|-------------|---------|-------|
| **HTTP (local)** | ✅ Full | Servers running on localhost with `url` field |
| **HTTP (remote)** | ✅ Full | Cloud-hosted servers like `https://mcp.amplitude.com/mcp` |
| **Stdio** | ❌ v2 | Command-based servers (`command` + `args`) - coming in v2 |

### Discovering Your MCP Servers

Agent Recorder can discover MCP servers from multiple configuration sources:

```bash
# See all MCP servers across all config sources
agent-recorder discover

# Output includes:
# - Claude Code (~/.claude/settings.json)
# - Cursor IDE (~/.cursor/mcp.json)
# - VS Code user settings
# - Project-level configs (.claude/settings.json)
```

### Testing with Example MCP Servers

**Built-in Mock Server:**
```bash
# Terminal 1: Start mock MCP server
agent-recorder mock-mcp --port 9999

# Terminal 2: Start Agent Recorder
agent-recorder start
```

**Using Real MCP Servers:**
```bash
# Fetch server (no API key needed)
npx -y @modelcontextprotocol/server-fetch

# Configure in ~/.agent-recorder/providers.json:
{
  "version": 1,
  "providers": [
    { "id": "fetch", "type": "http", "url": "http://localhost:3001" }
  ]
}
```

**Remote MCP Servers (like Amplitude):**
```json
{
  "version": 1,
  "providers": [
    {
      "id": "amplitude",
      "type": "http",
      "url": "https://mcp.amplitude.com/mcp"
    }
  ]
}
```

### Stdio Server Limitation

Stdio-based MCP servers (configured with `command` instead of `url`) are **not yet supported** in v1. These servers communicate via stdin/stdout rather than HTTP, which requires a different proxying approach.

**Examples of stdio servers that are NOT yet observable:**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

**Workaround:** If you need observability for a stdio server, check if an HTTP-based alternative exists, or wait for v2 which will include stdio support.

---

## What it does _not_ do (by design)

- ❌ No chain-of-thought or “reasoning” capture
- ❌ No prompt capture
- ❌ No orchestration / retries
- ❌ No tool blocking or policy enforcement
- ❌ No cloud sync (v1)
- ❌ No IDE plugin

Agent Recorder is **observability before control**.

---

## Tech stack (v1)

- Node.js (LTS) + TypeScript (strict)
- CLI: Node + Commander/Clipanion (implementation choice)
- Service: Fastify (or similar minimal HTTP server)
- DB: SQLite (`better-sqlite3`)
- UI: React + Vite (simple SPA)
- Packaging (later): npm global + optional single-binary packaging

See `docs/tech-stack.md`.

---

## Data & privacy

- All session data is stored **locally**
- No telemetry by default
- If telemetry is enabled, it is:
  - opt-in
  - anonymous
  - content-free (no prompts, no tool payloads)

See `docs/telemetry.md`.

---

## Development

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test install.test.ts
```

### Smoke Tests

End-to-end smoke tests validate critical functionality:

**Hubify Smoke Test** - Tests the complete hub mode flow:

```bash
# Run hubify smoke test
node scripts/smoke-hubify.mjs
```

This test:

1. Creates a temporary HOME with mock Claude config (2 providers)
2. Runs `agent-recorder install` (automatic hubify)
3. Starts 2 mock MCP servers on ports 19001/19002
4. Starts the daemon with custom test ports (18787/18788)
5. Calls hub `tools/list` and verifies aggregation of 2 namespaced tools
6. Calls hub `tools/call` and verifies routing to correct provider
7. Queries REST API to verify events recorded with `upstreamKey`
8. Cleans up all processes and temporary files

The test exits with code 0 on success, 1 on failure.

---

## License

MIT
