# Tech Stack

Decision: Node.js (LTS) + TypeScript (strict) for CLI/daemon/core.

- CLI: commander or clipanion
- Daemon: Fastify (or similar minimal server)
- DB: SQLite (better-sqlite3)
- UI: React + Vite
- Tests: Vitest (UI later optional)

Rationale: fastest iteration, aligns with Claude Code ecosystem, best for I/O-bound proxying.
