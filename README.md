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

## License

MIT
