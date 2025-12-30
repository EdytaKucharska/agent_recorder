# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

Agent Recorder is a local-first flight recorder for Claude Code that captures a persistent, human-readable timeline of execution including subagents, skills, and MCP tool calls. It uses a transparent MCP proxy pattern to record observable events **without capturing prompts or chain-of-thought**.

## Architecture

TypeScript monorepo with four packages:

- **packages/core** - Event model, redaction/truncation, storage (SQLite), shared types
- **packages/cli** - CLI commands (start, stop, status, open, session, config, telemetry)
- **packages/service** - Local daemon (Fastify recommended): MCP proxy + recorder + REST API (localhost only)
- **packages/ui** - React + Vite SPA served locally for inspection

### Event model (tree, not a strict chain)

Event types:

- `agent_call`
- `subagent_call`
- `skill_call`
- `tool_call`

Nesting rules:

- Tool calls can be direct children of `agent_call` or `subagent_call`.
- `skill_call` is optional; when present, `tool_call` may be nested under it.
- Preserve parent/child relationships to render a hierarchical timeline.

## Tech Stack

- **Runtime:** Node.js LTS + TypeScript (strict, ES2022)
- **CLI:** Commander.js or Clipanion
- **Server/Daemon:** Fastify (localhost only)
- **Database:** SQLite (`better-sqlite3`)
- **Frontend:** React + Vite
- **Testing:** Vitest (UI e2e optional later)

## Key Constraints (non-negotiable)

- Claude Code only (v1 scope). No other agent platforms.
- No prompt capture. No chain-of-thought/reasoning capture.
- Local-first: SQLite + localhost daemon + local web UI.
- No cloud sync / hosted mode in v1.
- Telemetry: PostHog is opt-in, anonymous, content-free, and must never affect proxying.
- Never block proxy on logging/telemetry. Fail open.

## Environment Variables

From `.env` (local only):

- `AR_LISTEN_PORT` (default 8787) - Local daemon port (proxy endpoints and/or REST)
- `AR_UI_PORT` (default 8788) - Local UI port
- `AR_DB_PATH` (default `.storage/agent-recorder.sqlite`)
- `AGENT_RECORDER_TELEMETRY` (default `off`)
- `AR_REDACT_KEYS` - comma-separated sensitive keys to redact from JSON payloads

## Required Reading (follow `.claude/INDEX.md`)

Read docs in this order before implementing:

1. docs/prd.md
2. docs/architecture.md
3. docs/claude-code-detection-rules.md
4. docs/ui-wireframes.md
5. docs/acceptance-tests-claude.md
6. docs/tech-stack.md
7. docs/coding-standards.md
8. docs/product-principles.md
9. docs/telemetry.md
10. docs/oss-model.md
11. docs/cli-ux.md

## Implementation Notes

- Map errors to stable categories (avoid raw downstream messages when possible).
- Redact + truncate aggressively; prefer losing data to leaking data.
- Keep dependencies minimal and boring.
- TypeScript path alias:
  - `@agent-recorder/core/*` → `packages/core/src/*`
