# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project Overview

Agent Recorder is a local-first flight recorder for Claude Code that captures a persistent, human-readable timeline of execution including subagents, skills, and MCP tool calls. It uses a transparent MCP proxy pattern to record observable events **without capturing prompts or chain-of-thought**.

## Architecture

TypeScript monorepo:

- **packages/types** - Portable type definitions (zero dependencies)
- **packages/core** - Event model, redaction/truncation, storage (SQLite), shared utilities
- **packages/service** - Local daemon (Fastify): MCP proxy + recorder + REST API (localhost only)
- **packages/cli** - CLI commands (start, stop, status, open, session, config, telemetry)
- **packages/hooks** - Claude Code hook handlers
- **packages/stdio-proxy** - STDIO proxy for MCP server observability
- **packages/ui** - React + Vite SPA served locally for inspection
- **packages/dist** - Distribution bundler for npm publishing

### Dependency flow

`types` → `core` → `service` / `hooks` / `stdio-proxy` → `cli` → `dist`

`ui` depends only on `types` (no Node/SQLite deps in the browser bundle).

### Event model (tree, not a strict chain)

Event types: `agent_call`, `subagent_call`, `skill_call`, `tool_call`

Nesting rules:

- Tool calls can be direct children of `agent_call` or `subagent_call`.
- `skill_call` is optional; when present, `tool_call` may be nested under it.
- Preserve parent/child relationships to render a hierarchical timeline.

## Workflow Orchestration

### 1. Plan Before Building

- Enter plan mode for any non-trivial task (3+ steps or architectural decisions).
- If something goes sideways, STOP and re-plan immediately.
- Write detailed specs upfront to reduce ambiguity.

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean.
- Offload research, exploration, and parallel analysis to subagents.
- One task per subagent for focused execution.

### 3. Verification Before Done

- Never mark a task complete without proving it works.
- Run `pnpm build && pnpm test && pnpm lint && pnpm format:check` before declaring done.
- Run `pnpm build:dist && pnpm smoke:dist` for changes touching packaging.
- Ask yourself: "Would a staff engineer approve this?"

### 4. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them.
- Go fix failing CI tests without being told how.

## Core Principles

- **Privacy is non-negotiable**: No prompt capture. No chain-of-thought. Redact + truncate aggressively; prefer losing data to leaking data.
- **Fail open**: Never block the MCP proxy on logging, telemetry, or recording errors. The proxy must always forward.
- **Local-first**: SQLite + localhost daemon + local web UI. No cloud sync in v1.
- **Simplicity first**: Make every change as simple as possible. Impact minimal code. Don't over-engineer.
- **No laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal impact**: Only touch what's necessary. No side effects with new bugs.
- **Dependencies**: Keep them minimal and boring.

## Key Constraints (non-negotiable)

- Claude Code only (v1 scope). No other agent platforms.
- Telemetry: PostHog is opt-in, anonymous, content-free, and must never affect proxying.
- Map errors to stable categories (avoid raw downstream messages when possible).
- TypeScript path alias: `@agent-recorder/core/*` → `packages/core/src/*`

## Tech Stack

- **Runtime:** Node.js LTS + TypeScript (strict, ES2022)
- **CLI:** Commander.js
- **Server/Daemon:** Fastify (localhost only)
- **Database:** SQLite (`better-sqlite3`)
- **Frontend:** React + Vite
- **Testing:** Vitest

## Environment Variables

From `.env` (local only):

- `AR_LISTEN_PORT` (default 8787) - Local daemon port
- `AR_UI_PORT` (default 8788) - Local UI port
- `AR_DB_PATH` (default `.storage/agent-recorder.sqlite`)
- `AGENT_RECORDER_TELEMETRY` (default `off`)
- `AR_REDACT_KEYS` - comma-separated sensitive keys to redact from JSON payloads
