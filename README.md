[![CI](https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml/badge.svg)](https://github.com/EdytaKucharska/agent_recorder/actions/workflows/ci.yml)

# Agent Recorder

Agent Recorder captures a **persistent, human-readable timeline** of what Claude Code actually executed — including **subagents**, **skills**, and **MCP tool calls** — so developers can debug, audit, and trust agent behavior.

Agent Recorder is designed to be **calm infrastructure**, not a chatbot.

---

> ## ⚠️ Architecture Pivot Notice (v2)
>
> **v1 (proxy-based)** has significant limitations. After extensive testing, we discovered:
>
> | Constraint                        | Impact                                                              |
> | --------------------------------- | ------------------------------------------------------------------- |
> | **~80% of MCP servers use stdio** | Cannot be proxied (subprocess communication)                        |
> | **OAuth-protected servers**       | Figma, Amplitude, Notion — tokens managed internally by Claude Code |
> | **Only works for**                | Self-hosted HTTP servers or rare static-API-key servers             |
>
> **v2 (hooks-based)** uses Claude Code's native hooks system to capture ALL tool calls regardless of transport.
>
> See [docs/article-mcp-observability-constraints.md](docs/article-mcp-observability-constraints.md) for the full technical writeup.
>
> **Current status:** v1 proxy code is deprecated. v2 hooks implementation in progress.

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

### v2 (Hooks-Based) — Recommended

v2 uses Claude Code's native hooks system. **All tool calls are captured regardless of transport:**

| Server Type        | Support | Notes                                  |
| ------------------ | ------- | -------------------------------------- |
| **stdio**          | ✅ Full | npx/uvx servers, filesystem, git, etc. |
| **HTTP (local)**   | ✅ Full | Servers running on localhost           |
| **HTTP (remote)**  | ✅ Full | Figma, Amplitude, Notion — even OAuth! |
| **Built-in tools** | ✅ Full | Bash, Read, Write, Edit, Glob, Grep    |

```bash
# Install hooks into Claude Code
agent-recorder install

# Start the service (receives hook data)
agent-recorder start

# Open the UI
agent-recorder open
```

### v1 (Proxy-Based) — Deprecated

<details>
<summary>v1 proxy approach (click to expand)</summary>

v1 worked by proxying MCP traffic. It only supported HTTP servers with static auth:

| Server Type       | Support    | Notes                                               |
| ----------------- | ---------- | --------------------------------------------------- |
| **HTTP (local)**  | ⚠️ Limited | Only non-OAuth servers                              |
| **HTTP (remote)** | ⚠️ Limited | Only servers accepting API keys (rare)              |
| **Stdio**         | ❌ None    | Cannot proxy subprocess communication               |
| **OAuth servers** | ❌ None    | Figma, Amplitude, Notion — tokens managed by Claude |

**Why v1 doesn't work for most servers:**

- ~80% of MCP servers use stdio transport (not HTTP)
- OAuth-protected servers don't expose tokens to proxies
- Claude Code manages auth internally

</details>

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
