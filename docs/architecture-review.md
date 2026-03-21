# Agent Recorder — Architecture Review & Restructuring Recommendations

## Executive Summary

Agent Recorder is a well-built local-first flight recorder for Claude Code with solid fundamentals: fail-open proxy pattern, aggressive redaction, clean TypeScript, and a working monorepo. However, the project has grown organically and now conflates three distinct deployment contexts — **local daemon**, **embeddable library**, and **web UI** — into a flat package structure that makes it unclear what runs where, what depends on what, and where the extension points are.

This review provides a structural diagnosis and a concrete plan to make the project legible, extensible, and professional-grade.

---

## Part 1: What's Working Well

### Strengths

1. **Privacy-first design** — No prompt capture, no chain-of-thought. Redaction is applied before storage. This is the right default.

2. **Fail-open proxy pattern** — Recording failures never block MCP forwarding. The `recordToolCall` function wraps everything in try/catch and returns null on failure. This is critical for a transparent proxy.

3. **Denormalized event model** — The flat `events` table with `tool_name`, `mcp_method`, `upstream_key` columns avoids JOINs for the hot path (insert + query). Good trade-off for a local SQLite store.

4. **Atomic sequence allocation** — Using a separate `session_sequences` table with `UPDATE ... RETURNING` prevents sequence gaps under concurrent inserts. Correct approach for better-sqlite3's synchronous API.

5. **Multiple capture methods** — Three complementary recording strategies (HTTP proxy, STDIO proxy, Claude Code hooks) cover different integration patterns. This is forward-thinking.

6. **Clean TypeScript** — Strict mode, ES2022 target, NodeNext module resolution. No `any` abuse. Type narrowing in the proxy is done correctly.

7. **CLI completeness** — 40+ commands with consistent Commander.js patterns, proper error handling, and both human-readable and JSON output modes.

---

## Part 2: Structural Problems

### Problem 1: No Clear Boundary Between "Local-Only" and "Embeddable"

The current package structure:

```
packages/
  core/          ← types + DB + config + daemon paths + redaction
  service/       ← Fastify daemon + MCP proxy + REST API
  cli/           ← Commander.js CLI
  ui/            ← placeholder React SPA
  stdio-proxy/   ← STDIO MCP wrapper
  hooks/         ← Claude Code hook handler
  dist/          ← npm bundle
```

**What's unclear:**

- `core` mixes portable types (`events.ts`, `session.ts`) with local-only concerns (`daemon-paths.ts`, `lockfile.ts`, `config.ts` that reads `process.env`). If someone wants to embed just the event model in their agent framework, they get SQLite, homedir paths, and process management as transitive dependencies.

- `service` is the daemon, but it also contains the embeddable MCP proxy logic. The `createMcpProxy()` function could be used standalone (e.g., inside an n8n node or a LangGraph step), but it's coupled to Fastify and daemon lifecycle.

- `hooks` and `stdio-proxy` are standalone binaries but share no clear contract with `service`. They POST to `http://127.0.0.1:${port}` and hope the daemon is running.

**Impact:** A developer looking at this can't answer "what can I `import` into my own agent?" without reading every file.

### Problem 2: The Event Model Is Underspecified for Hierarchy

The event types (`agent_call`, `subagent_call`, `skill_call`, `tool_call`) and `parentEventId` field support nesting in theory, but:

- The HTTP proxy recorder (`packages/service/src/mcp/recorder.ts:77-95`) always sets `parentEventId: null` and `eventType: "tool_call"`. It never creates `agent_call` or `subagent_call` events. The hierarchy is flat in practice.

- The hooks handler (`packages/service/src/routes/hooks.ts:159-213`) maps `Task` → `subagent_call` and `Skill` → `skill_call`, but also always sets `parentEventId: null`. No nesting is actually built.

- `PreToolUse` hooks are received but not recorded (line 148-156). This means there's no "running" state — events appear only after completion.

- `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd` hooks are received but only logged to console in debug mode. No session lifecycle events are recorded.

**Impact:** The hierarchical timeline promised in the PRD and architecture docs doesn't exist in the implementation. Users see a flat list of tool calls.

### Problem 3: Module Globals in `service/src/index.ts`

```typescript
let daemonMode = false;
let daemonSessionId: string | null = null;
let daemonStartedAt: string | null = null;
```

These module-level globals (`service/src/index.ts:46-48`) are shared across the entire process. The `getDaemonInfo()` function exposes them. If someone imports `startDaemon` twice (e.g., in tests), state leaks between calls. The `isShuttingDown` flag inside `startDaemon` is correctly scoped in the closure, but the daemon info isn't.

### Problem 4: The `dist` Package Is a Bundling Workaround

`packages/dist` copies compiled output from all workspace packages into a `vendor/` directory and re-exports the CLI. This is because `better-sqlite3` has native bindings that don't work well with standard bundlers. The approach works but:

- The `bundle.ts` script is fragile — it hardcodes paths to workspace packages.
- Version drift between workspace packages and `dist` dependencies is possible.
- The `bin` entries point to `vendor/node_modules/...` paths which is non-standard.

### Problem 5: UI Is a Placeholder

`packages/ui/src/main.tsx` contains `export {};`. The package has no Vite config, no React dependencies (only `@agent-recorder/core`), and no routes. It's been in this state since initial scaffolding. This creates noise in the monorepo — it shows up in builds, IDE indexing, and dependency graphs without contributing anything.

### Problem 6: Redaction Recreates `lowerKeys` Set on Every Call

```typescript
// packages/core/src/utils/redact.ts:23
const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
```

This runs on every recursive call into `redactJson`. For deeply nested objects with many keys, this creates O(depth × keys) Set allocations. The set should be created once at the top-level call and passed down.

### Problem 7: Upstreams Registry Loaded on Every Request

```typescript
// packages/service/src/mcp/proxy.ts:463
const registry = loadUpstreamsRegistry(upstreamsPath);
```

`loadUpstreamsRegistry` does `readFileSync` + `JSON.parse` on every incoming request in router mode. For high-throughput scenarios this is unnecessary I/O. The registry should be loaded once and optionally refreshed on file change (fs.watch).

### Problem 8: No Input Validation on REST API

The Fastify routes in `routes/sessions.ts`, `routes/events.ts`, and `routes/hooks.ts` don't use Fastify's schema validation. Request bodies are cast with `as` without runtime validation:

```typescript
// routes/hooks.ts:131
app.post<{ Body: HookEventPayload }>("/api/hooks", async (request, reply) => {
  const payload = request.body; // no validation
```

Fastify has built-in JSON Schema validation that's both safer and faster (it compiles schemas to validators). Not using it means malformed requests could cause unexpected behavior.

### Problem 9: SSE Parsing Is Fragile

```typescript
// packages/service/src/mcp/proxy.ts:672-683
const dataLines = text
  .split("\n")
  .filter((line) => line.startsWith("data: "))
  .map((line) => line.slice(6));
```

This SSE parser assumes:
- All data fits in memory (no streaming)
- The last `data:` line is always the final JSON-RPC response
- No multi-line SSE data fields
- No `event:` type filtering

For a proxy that needs to handle arbitrary MCP servers (including Figma's streaming responses), this should use a proper SSE parser or at minimum handle chunked responses.

---

## Part 3: Recommended Restructuring

### New Package Layout

```
packages/
  types/              ← ZERO dependencies. Event model, session types, error categories.
                         Portable — safe to import anywhere (agents, SDKs, cloud).

  storage/            ← SQLite implementation of event/session storage.
                         Depends on: types, better-sqlite3.
                         Local-only — never import this in a web/cloud context.

  recorder/           ← Core recording logic: redaction, truncation, sequence allocation.
                         Depends on: types, storage.
                         Can be used as a library by any capture method.

  proxy-http/         ← HTTP MCP proxy (Fastify). Transparent forward + record.
                         Depends on: recorder, types.
                         Embeddable — can be mounted in any Fastify app.

  proxy-stdio/        ← STDIO MCP proxy (child_process wrapper).
                         Depends on: recorder, types.
                         Standalone binary.

  hooks/              ← Claude Code hook handler.
                         Depends on: types (lightweight — no SQLite).
                         Posts to daemon REST API.

  daemon/             ← Local daemon lifecycle: start/stop, PID, lock, port files.
                         Depends on: proxy-http, storage, recorder.
                         Local-only — this is the "server" that runs on your machine.

  rest-api/           ← REST API routes (sessions, events, health).
                         Depends on: storage, types.
                         Embeddable — can be mounted in any Fastify app.

  cli/                ← Commander.js CLI. Depends on: daemon, rest-api.
                         Local-only.

  ui/                 ← React + Vite SPA. Depends on: types (for display).
                         Can be served locally OR embedded as a panel.

  dist/               ← npm distribution bundle.
```

### What This Achieves

| Package | Local-only? | Embeddable in agent? | Web-safe? |
|---------|------------|---------------------|-----------|
| `types` | No | Yes | Yes |
| `storage` | Yes (SQLite) | No | No |
| `recorder` | Yes (uses storage) | Partially (with custom storage adapter) | No |
| `proxy-http` | No | Yes (Fastify plugin) | No (Node.js) |
| `proxy-stdio` | No | Yes (standalone bin) | No (Node.js) |
| `hooks` | No | Yes (Claude-specific) | No (Node.js) |
| `daemon` | Yes | No | No |
| `rest-api` | No | Yes (Fastify plugin) | No (Node.js) |
| `cli` | Yes | No | No |
| `ui` | No | Yes (React component) | Yes |

### Key Architectural Principle

**The dependency arrow should always point inward:**

```
cli → daemon → proxy-http → recorder → storage → types
                                ↑
                         rest-api ─┘
```

Nothing in `types` should import from `storage`. Nothing in `recorder` should know about Fastify. Nothing in `proxy-http` should know about PID files.

---

## Part 4: Specific Improvements

### 4.1 Extract a Storage Interface

Create a `StorageAdapter` interface in `types/` so the recorder isn't hardcoded to SQLite:

```typescript
// packages/types/src/storage.ts
export interface StorageAdapter {
  insertEvent(event: InsertEventInput): RecordedEvent;
  getEventsBySession(sessionId: string, options?: EventQueryOptions): RecordedEvent[];
  createSession(id: string, startedAt: string): Session;
  endSession(id: string, endedAt: string, status: SessionStatus): Session | null;
  allocateSequence(sessionId: string): number;
}
```

Then `packages/storage/` provides `SqliteStorageAdapter implements StorageAdapter`. The recorder accepts `StorageAdapter` instead of `Database.Database`. This allows:
- In-memory storage for tests (no SQLite needed)
- Future cloud storage adapters
- Embedding in agents that use their own persistence

### 4.2 Fix the Hierarchy Gap

Implement actual nesting by:

1. **Record `PreToolUse` as "running" events** — Create the event with `status: "running"` and `endedAt: null`. On `PostToolUse`, update the existing event instead of creating a new one. This gives real duration tracking.

2. **Track parent context** — Use `SessionStart` to create an `agent_call` event. Use `SubagentStop` metadata to create `subagent_call` events. Set `parentEventId` based on the Claude session's subagent context.

3. **Add a `context_stack` to the hooks handler** — Maintain a per-session stack of active event IDs. When a tool call comes in, its parent is the top of the stack.

### 4.3 Cache the Upstreams Registry

```typescript
// In proxy-http, load once and watch for changes
class UpstreamsCache {
  private registry: UpstreamsRegistry = {};
  private watcher: fs.FSWatcher | null = null;

  constructor(private path: string) {
    this.reload();
    this.watcher = fs.watch(path, () => this.reload());
  }

  private reload(): void {
    try {
      this.registry = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    } catch {
      // keep previous value
    }
  }

  get(key: string): UpstreamEntry | undefined {
    return this.registry[key];
  }

  close(): void {
    this.watcher?.close();
  }
}
```

### 4.4 Add Fastify Schema Validation

```typescript
// routes/hooks.ts
const hookEventSchema = {
  body: {
    type: 'object',
    required: ['hook_type', 'session_id'],
    properties: {
      hook_type: { type: 'string' },
      session_id: { type: 'string' },
      tool_name: { type: 'string' },
      tool_input: { type: 'object' },
      tool_response: {},
    },
  },
} as const;

app.post('/api/hooks', { schema: hookEventSchema }, async (request, reply) => {
  // request.body is now validated
});
```

### 4.5 Fix Redaction Performance

```typescript
export function redactJson(value: unknown, keys: string[]): unknown {
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  return redactJsonInternal(value, lowerKeys);
}

function redactJsonInternal(value: unknown, lowerKeys: Set<string>): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactJsonInternal(item, lowerKeys));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = lowerKeys.has(k.toLowerCase()) ? REDACTED_VALUE : redactJsonInternal(v, lowerKeys);
    }
    return result;
  }
  return value;
}
```

### 4.6 Replace Module Globals with a DaemonContext

```typescript
export interface DaemonContext {
  mode: "daemon" | "foreground";
  sessionId: string;
  startedAt: string;
  db: Database.Database;
  config: Config;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonHandle> {
  const context: DaemonContext = { /* ... */ };

  const app = await createServer({ ...context });
  // Pass context to health route instead of using module globals
}
```

### 4.7 Handle the UI Decision

Either:

**Option A: Remove `packages/ui/` entirely** until there's a plan to build it. A placeholder package adds confusion. Add a `docs/ui-plan.md` instead.

**Option B: Scaffold a minimal working UI** with:
- Vite + React + TanStack Router
- Session list page (calls `GET /api/sessions`)
- Session detail page (calls `GET /api/sessions/:id/events`)
- Auto-refresh via polling or SSE

Option B is recommended — even a basic working UI demonstrates the value of the REST API and validates the data model.

### 4.8 Add an `agent-recorder/embed` Export

For the npm package, expose a clean embedding API:

```typescript
// packages/dist/src/embed.ts
export { createMcpProxy, type McpProxyOptions } from '@agent-recorder/proxy-http';
export { createRestApi } from '@agent-recorder/rest-api';
export { SqliteStorageAdapter } from '@agent-recorder/storage';
export type { StorageAdapter, RecordedEvent, Session } from '@agent-recorder/types';
```

This gives agent developers a single import for embedding recording into their tools.

---

## Part 5: Priority Order

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| **P0** | Fix redaction performance (4.5) | 30 min | Correctness |
| **P0** | Add Fastify schema validation (4.4) | 2 hrs | Security |
| **P1** | Replace module globals (4.6) | 1 hr | Testability |
| **P1** | Cache upstreams registry (4.3) | 1 hr | Performance |
| **P1** | Fix hierarchy — record PreToolUse + parent tracking (4.2) | 4 hrs | Core feature |
| **P2** | Extract `types` package from `core` (Part 3) | 4 hrs | Architecture |
| **P2** | Extract `StorageAdapter` interface (4.1) | 3 hrs | Extensibility |
| **P2** | Build minimal working UI (4.7 Option B) | 8 hrs | User value |
| **P3** | Full package restructuring (Part 3) | 2-3 days | Long-term clarity |
| **P3** | Add `embed` export (4.8) | 2 hrs | Developer experience |

---

## Part 6: What "Pro-Grade" Looks Like

A professional open-source observability tool at this stage should have:

1. **Clear README sections**: "Install", "Quick Start", "Architecture", "Embedding", "API Reference". The current README is comprehensive but mixes user guide with developer docs.

2. **Package-level READMEs**: Each package should have a 5-line README explaining what it is, who imports it, and one usage example.

3. **Integration tests**: The current tests are unit-level. Add integration tests that start the daemon, make MCP proxy calls, and verify events appear in the database.

4. **OpenAPI spec for the REST API**: Auto-generate from Fastify schemas. This documents the API without separate docs that drift.

5. **Changelog**: Track what changed between versions. The OIDC publishing pipeline creates tags but there's no CHANGELOG.md.

6. **Error budget monitoring**: The fail-open pattern is correct, but add metrics (even just counters) for how often recording fails. If the failure rate exceeds a threshold, something is wrong.

7. **Consistent naming**: The codebase uses both "downstream" and "upstream" for MCP servers. In proxy terminology: the client is upstream, the server is downstream. But the code uses "downstream" for the server being proxied (`downstreamMcpUrl`) and "upstream" for the server registry (`upstreamsPath`). Pick one convention and stick with it.

---

## Conclusion

Agent Recorder has strong bones. The core recording pattern is correct, the privacy design is sound, and the CLI is genuinely useful. The main investment needed is **structural clarity** — making the boundary between "local daemon" and "embeddable library" explicit through package boundaries, interfaces, and documentation. The hierarchy gap (flat events vs. promised tree) is the biggest feature debt and should be addressed alongside the structural work.

The recommended approach: fix the P0 items immediately, tackle P1 over the next sprint, and plan the full restructuring (P2/P3) as a tracked milestone.
