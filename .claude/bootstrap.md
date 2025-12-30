Build Agent Recorder per docs in this repo.

Constraints:

- Claude Code only (v1)
- Node.js (LTS) + TypeScript (strict)
- Local-first: SQLite + localhost daemon + local web UI
- No prompt capture, no chain-of-thought capture
- Telemetry: PostHog opt-in, anonymous, content-free; never affects proxying

Read `.claude/INDEX.md` then implement v1 deliverables:

- monorepo scaffold (core, cli, service, ui)
- MCP proxy recorder (transparent forward + record)
- hierarchical event model + SQLite schema/migrations
- REST API + CLI + local web UI
- tests aligned with docs/acceptance-tests-claude.md

Start by summarizing constraints (10 bullets), scaffold repo, then implement core types + SQLite schema. Stop.
