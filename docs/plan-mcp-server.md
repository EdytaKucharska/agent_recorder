# Implementation Plan: Agent Recorder MCP Server

## Context

Agent Recorder captures a rich, structured timeline of agent execution (tool calls, subagent delegations, skill invocations, token counts, error states) stored in local SQLite. Currently this data is only accessible via the AR CLI and local web UI.

**Problems this solves:**

1. Observability data is trapped inside AR — external runtimes (n8n, LangGraph, CrewAI) can't query what happened in a Claude Code session
2. Non-Claude-Code agents can't record to AR — only proxied events are captured, no standard interface for external agents to report their own events
3. Token/cost roll-up data has no programmatic consumer

**Solution:** Expose AR's data and event ingestion as a standard MCP server (`packages/mcp-server`), mounted on the existing Fastify daemon at `/mcp`, sharing the same SQLite instance.

---

## Codebase Reality Check (gaps between PRD and current code)

These were discovered during exploration and must be addressed before/during implementation:

### Gap 1: Existing MCP server must be replaced, not extended

`packages/cli/src/commands/mcp-server.ts` already exists — a 521-line hand-rolled HTTP JSON-RPC server with 6 read-only tools (`check_health`, `list_sessions`, `get_session_summary`, `get_errors`, `get_tool_call_stats`, `get_latest_session_summary`). It proxies to the daemon's REST API and binds to `0.0.0.0` (violates localhost-only). **This file will be entirely replaced** by the new implementation. The new tools supersede all 6 existing ones.

`@modelcontextprotocol/sdk` is **not currently installed** anywhere in the project. It must be added as a new dependency.

### Gap 2: Missing `source` column — requires DB migration

The events table has no `source` column. The PRD's write path (`ar_record_event`, `ar_record_batch`) requires this to distinguish proxy-captured vs externally-ingested events. **A new migration is required:**

```sql
-- packages/core/migrations/008_add_source_column.sql
ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'proxy';
```

All existing proxy-captured rows will default to `'proxy'`.

### Gap 3: No tree-building logic exists

`getEventsBySession()` returns a flat `BaseEvent[]` ordered by sequence. The `parent_event_id` column exists but no code builds or traverses the tree. `buildEventTree()` and `computeRollup()` are entirely new and must be written in `packages/mcp-server/src/rollup/token-rollup.ts`.

### Gap 4: `ar_list_sessions` needs new aggregation SQL

`listSessions()` and `listSessionsWithActivity()` return bare session records with no event counts, token totals, or error counts. A new `listSessionsSummary()` function using a `LEFT JOIN` + `GROUP BY` is required in `packages/core/src/db/sessions.ts`.

### Gap 5: No `queryTokenUsageAggregated()` exists

`getTokenSummary()` works for a single session. The PRD's `ar_query_token_usage` needs cross-session aggregation with GROUP BY dimensions. New function `queryTokenUsageAggregated()` required in `packages/core/src/db/token-metrics.ts`.

---

## Architecture Overview

```
packages/mcp-server/
├── src/
│   ├── index.ts                   # Public exports
│   ├── server.ts                  # createMcpServer(opts) → McpServer
│   ├── fastify-plugin.ts          # createFastifyPlugin(opts) → Fastify plugin
│   ├── stdio.ts                   # Standalone STDIO entry point
│   ├── tools/
│   │   ├── read/
│   │   │   ├── list-sessions.ts   # ar_list_sessions
│   │   │   ├── get-session.ts     # ar_get_session
│   │   │   ├── query-token-usage.ts # ar_query_token_usage
│   │   │   ├── get-token-budget.ts  # ar_get_token_budget
│   │   │   └── list-upstreams.ts  # ar_list_upstreams
│   │   └── write/
│   │       ├── record-event.ts    # ar_record_event
│   │       ├── complete-event.ts  # ar_complete_event
│   │       └── record-batch.ts    # ar_record_batch
│   ├── pricing/
│   │   ├── config.ts              # Load static pricing.json
│   │   └── estimator.ts           # estimateCost(input, output, model)
│   ├── rollup/
│   │   └── token-rollup.ts        # buildEventTree + computeRollup
│   ├── validation/
│   │   ├── schemas.ts             # All Zod schemas + inferred types
│   │   └── redaction.ts           # stripSensitiveKeys + applyRedaction
│   └── rate-limiter.ts            # Token-bucket per clientId
└── tests/
```

**Daemon integration:**

```
/api/*   → REST API (existing)
/proxy/* → MCP Proxy (existing)
/mcp     → MCP Server (new, this feature)
```

**Transports:**

- **Streamable HTTP (primary):** `http://localhost:{AR_LISTEN_PORT}/mcp`
- **STDIO (secondary):** `packages/mcp-server/src/stdio.ts` standalone entry

---

## MCP Tools

### Phase 1 – Read Tools

| Tool                   | Purpose                                              | Key Parameters                                                                  |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ar_list_sessions`     | List recorded sessions with summary metrics          | `limit` (max 100), `offset`, `status`, `since`, `upstream_key`                  |
| `ar_get_session`       | Full event tree with recursive token roll-up         | `session_id` (req), `depth` (1–10, **default 10**), `event_types`, `include_io` |
| `ar_query_token_usage` | Aggregated token usage with grouping                 | `group_by` (session/upstream/tool/day), time range, filters                     |
| `ar_get_token_budget`  | Current token budget status for active session       | `session_id` (req)                                                              |
| `ar_list_upstreams`    | All known upstream MCP servers with activity metrics | `since` (optional)                                                              |

> **Depth decision (Issue 2):** PRD specifies "unlimited" by default. We cap at 10 for performance but default to 10 rather than 3 — a depth of 3 would silently cut off real agent chains (agent_call → subagent_call → skill_call → tool_call is already 4 levels). Clients wanting a shallow view pass `depth: 2` explicitly.

### Phase 2 – Write Tools

| Tool                | Purpose                                       | Key Parameters                                                          |
| ------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `ar_record_event`   | Record single execution event                 | `event_type`, `session_id`, `source`, `started_at` (req); many optional |
| `ar_complete_event` | Update in-progress event with completion data | `event_id`, `session_id`, `ended_at`, `status` (all req)                |
| `ar_record_batch`   | Record up to 100 events atomically            | `session_id`, `source`, `events[]` (max 100)                            |

### Phase 3 – Cost Estimation

Static `pricing.json` at `AR_PRICING_PATH` (default `.storage/pricing.json`):

```json
{
  "models": {
    "claude-sonnet-4": { "input_per_mtok": 3.0, "output_per_mtok": 15.0 },
    "claude-haiku-4-5": { "input_per_mtok": 0.25, "output_per_mtok": 1.25 }
  },
  "default_model": "claude-sonnet-4"
}
```

All cost fields labeled `estimated_*`. Loaded once at server startup, not per-request.

---

## Implementation Steps (Sequential)

### Step 0 — DB Migrations (prerequisite for write tools)

**Two migrations required:**

**`packages/core/migrations/008_add_source_column.sql`**

```sql
ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'proxy';
```

All existing proxy-captured rows default to `'proxy'`. Externally-ingested events carry the caller-supplied value (e.g. `'n8n'`, `'langgraph'`).

**`packages/core/migrations/009_add_model_column.sql`**

```sql
ALTER TABLE events ADD COLUMN model TEXT;
```

Optional field for cost estimation. NULL = use default pricing rate. Populated only for externally-ingested events where the caller knows the model.

Also update these files to include both new columns:

- `InsertEventInput` in `packages/types/src/storage.ts` — add `source?: string` (defaults to `'proxy'`), `model?: string | null`
- `BaseEvent` in `packages/types/src/events.ts` — add `source: string`, `model: string | null`
- `rowToEvent()` in `packages/core/src/db/events.ts` — map `row.source` → `source`, `row.model` → `model`
- `insertEvent()` SQL in `packages/core/src/db/events.ts` — include both columns in INSERT

---

### Step 1 — Package Scaffolding

**Files to create:**

- `packages/mcp-server/package.json`
- `packages/mcp-server/tsconfig.json` (extend `../../tsconfig.base.json`)

**Dependencies:**

```json
{
  "dependencies": {
    "@agent-recorder/core": "workspace:*",
    "@agent-recorder/types": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.x",
    "zod": "^3.x"
  }
}
```

`@modelcontextprotocol/sdk` is a **new dependency not currently installed** in the project. `better-sqlite3` as devDependency only (DB injected, never opened by this package).

---

### Step 2 — Infrastructure Layer

#### `src/validation/schemas.ts`

All Zod schemas with `z.infer<>` types exported alongside:

- `ListSessionsInputSchema` — limit max 100, offset, optional status/since/upstream_key
- `GetSessionInputSchema` — session_id required, depth 1–10 **default 10**, optional event_types array, include_io boolean
- `QueryTokenUsageInputSchema` — group_by enum, time range, filters, limit max 500
- `GetTokenBudgetInputSchema` — session_id required
- `ListUpstreamsInputSchema` — since optional ISO string
- `RecordEventInputSchema` — event_type/session_id/source/started_at required; **`model` (optional string, top-level)** for cost estimation; all other optional BaseEvent fields; see Issue 1 note below
- `CompleteEventInputSchema` — event_id/session_id/ended_at/status required
- `RecordBatchInputSchema` — session_id/source required, events array max 100

Each schema's `.shape` passed directly as MCP tool `inputSchema`.

> **`model` field decision (Issue 1):** The PRD's open question asks whether `ar_record_event` should accept `model` at the top level (not just buried in `metadata`). **Yes, add it now.** `model` is used by `estimateCost()` to pick the right pricing tier for externally-ingested events. Adding it later would be a breaking change for clients already omitting it. It is stored as a column on `events` — **this requires a second migration:**
>
> ```sql
> -- packages/core/migrations/009_add_model_column.sql
> ALTER TABLE events ADD COLUMN model TEXT;
> ```
>
> `model` is optional (null = use default pricing rate). Add to `InsertEventInput`, `BaseEvent`, `rowToEvent()`, and `insertEvent()` SQL alongside the `source` changes in Step 0.

> **`@agent-recorder/types` confirmation (Issue 4):** `packages/types` is a real package in this monorepo (confirmed by exploration). It has zero dependencies and exports `EventType`, `EventStatus`, `ErrorCategory`, `BaseEvent`, `InsertEventInput`, `StorageAdapter`, etc. The import `@agent-recorder/types` is valid and maps to `packages/types/src/index.ts` via the workspace.

#### `src/validation/redaction.ts`

```typescript
const STRIPPED_KEYS = new Set([
  "prompt",
  "system_prompt",
  "reasoning",
  "chain_of_thought",
  "messages",
  "thought",
  "thinking",
]);

export function stripSensitiveKeys(
  obj: Record<string, unknown>
): Record<string, unknown>;
export function applyRedaction(obj: unknown, extraKeys: string[]): unknown;
```

Strip (remove key entirely) happens before redact (replace value with `[REDACTED]`). Write tools apply both in sequence. `redactAndTruncate` from `@agent-recorder/core` handles the AR_REDACT_KEYS pass.

#### `src/rollup/token-rollup.ts`

```typescript
export interface EventNode extends BaseEvent {
  children: EventNode[];
  rolledUpInputTokens: number;
  rolledUpOutputTokens: number;
}

export function buildEventTree(
  events: BaseEvent[],
  maxDepth: number
): EventNode[];
export function computeRollup(node: EventNode): void;
```

Pure functions — no DB access. `getEventsBySession` already returns events ordered by `sequence ASC`. Build `Map<string|null, BaseEvent[]>` keyed by `parentEventId`, walk from root.

#### `src/pricing/config.ts` + `src/pricing/estimator.ts`

```typescript
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  modelKey?: string
): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number };
```

Pricing config loaded once at startup from `AR_PRICING_PATH`. Falls back to `default_model` for unknown models.

#### `src/rate-limiter.ts`

```typescript
export class RateLimiter {
  constructor(limits: { read: number; write: number; batch: number });
  check(sessionId: string, tier: "read" | "write" | "batch"): boolean;
}
```

Token-bucket, 1-second window, counters per `(sessionId, tier)`. **`sessionId` comes from the tool parameters** (the `session_id` field in write tool inputs, or `session_id` param in read tools) — not from the MCP transport's `Mcp-Session-Id` header. This correctly scopes rate limits to AR sessions, not MCP transport sessions. An MCP client can reconnect (new transport session) without resetting their AR session rate window. For read tools without a `session_id` param (e.g. `ar_list_sessions`, `ar_list_upstreams`), key on `"global"` as the sessionId. Max 1000 slots before eviction.

Rate limits per PRD:

- `read`: 50 calls/second
- `write`: 100 calls/second per session
- `batch`: 10 calls/second

---

### Step 3 — New Core DB Functions

> Note: `getEventsBySession()`, `completeEvent()`, `insertEvent()`, `allocateSequence()` all exist and are reused as-is (after Step 0 adds `source` to `insertEvent`).

Add to `packages/core/src/db/` (reuse existing query patterns):

**`packages/core/src/db/sessions.ts`**

```typescript
export interface SessionSummaryRow extends SessionWithActivity {
  eventCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export function listSessionsSummary(
  db: Database.Database,
  opts: {
    limit: number;
    offset: number;
    status?: SessionStatus;
    since?: string;
    upstreamKey?: string;
  }
): SessionSummaryRow[];
```

Single SQL query with `LEFT JOIN` on events, `GROUP BY session_id`.

**`packages/core/src/db/token-metrics.ts`**

```typescript
export interface AggregatedTokenRow {
  groupKey: string;
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd?: number;
  errorCount: number;
  avgDurationMs: number;
}

export function queryTokenUsageAggregated(
  db: Database.Database,
  opts: {
    groupBy: "session" | "upstream" | "tool" | "day";
    since?: string;
    until?: string;
    sessionId?: string;
    upstreamKey?: string;
    limit: number;
  }
): AggregatedTokenRow[];
```

Four SQL GROUP BY patterns (switch on `groupBy`). Day grouping uses `DATE(started_at)`.

**`packages/core/src/db/upstreams.ts`** (new file)

```typescript
export interface UpstreamActivityRow {
  upstreamKey: string;
  callCount: number;
  sessionCount: number;
  lastSeenAt: string;
  totalTokens: number;
}

export function listUpstreamActivity(
  db: Database.Database,
  since?: string
): UpstreamActivityRow[];
```

SQL aggregates on `events` table where `event_type = 'tool_call'` and `upstream_key IS NOT NULL`, `GROUP BY upstream_key`, `ORDER BY last_seen_at DESC`.

**`packages/core/src/db/index.ts`** — export all new functions.

---

### Step 4 — Read Tools

Each file in `src/tools/read/` exports:

```typescript
export function register(
  server: McpServer,
  db: Database.Database,
  opts: McpServerOptions
): void;
```

**`list-sessions.ts`** — calls `listSessionsSummary()` from core. Returns paginated array of session summaries.

**`get-session.ts`** — calls `getEventsBySession()` from core → `buildEventTree()` → `computeRollup()`. Strips `inputJson`/`outputJson` if `include_io=false`. Prunes to `depth`. Applies `event_types` filter (keeps ancestors of matching nodes).

**`query-token-usage.ts`** — calls `queryTokenUsageAggregated()` from core. Returns grouped rows with optional cost estimates.

**`get-token-budget.ts`** — calls `getTokenSummary()` from core (already exists at `packages/core/src/db/token-metrics.ts`). Enriches with `estimateCost()` from pricing layer.

**`list-upstreams.ts`** — calls `listUpstreamActivity()` from core.

---

### Step 5 — Write Tools

**`record-event.ts`** (`ar_record_event`):

1. Validate with `RecordEventInputSchema`
2. **Session auto-creation (Issue 3):** Call `getSessionById(db, sessionId)`. If null, call `createSession(db, sessionId, event.started_at)` — use the event's `started_at` as the session's start time, status defaults to `'active'`. The session has no name/description beyond its ID. This matches how `hooks.ts` handles `SessionStart` events. Do NOT error if session doesn't exist — silently create it.
3. `stripSensitiveKeys` on `input_json`/`output_json`/`metadata`
4. `redactAndTruncate` with `opts.redactKeys`
5. `allocateSequence(db, sessionId)` for sequence number — reuses `allocateSequence()` from `@agent-recorder/core/src/db/sequences.ts`
6. Generate `event_id` with `randomUUID()` if not provided
7. Call `insertEvent(db, { ...fields, source, model })` — `source` comes from the tool input (required field); `model` is optional for cost estimation
8. Return `{ event_id, session_id, stored: true, deduplicated: false }`

Idempotent: if `event_id` already exists in same session, return `{ deduplicated: true }` without error.

**`complete-event.ts`** (`ar_complete_event`):

1. Validate with `CompleteEventInputSchema`
2. Verify `event_id` belongs to `session_id` (cross-session protection)
3. Call `completeEvent(db, ...)` from `@agent-recorder/core/src/db/events.ts`
4. If already completed, return no-op (idempotent)

**`record-batch.ts`** (`ar_record_batch`):
Wraps record-event logic in `db.transaction(...)` for atomicity. Zod `.max(100)` enforces batch size. Returns `{ session_id, stored, deduplicated, errors[] }`.

---

### Step 6 — Server Assembly

**`src/server.ts`**

```typescript
export interface McpServerOptions {
  db: Database.Database;
  redactKeys?: string[];
  contextBudgetTokens?: number;
  rateLimits?: { read: number; write: number; batch: number };
}

export function createMcpServer(opts: McpServerOptions): McpServer;
```

Instantiates `McpServer`, calls each `register()` function, returns configured server (transport is caller's responsibility).

**`src/fastify-plugin.ts`**

```typescript
export function createFastifyPlugin(opts: McpServerOptions): FastifyPluginAsync;
```

Creates `McpServer`, creates `StreamableHTTPServerTransport` per session (managed via `Map<sessionId, transport>`), registers `POST /mcp`, `GET /mcp`, `DELETE /mcp` routes. Connects server to transport. Cleans up on `onClose` hook.

**`src/stdio.ts`** (standalone STDIO entry)
Opens DB via `openDatabase(config.dbPath)`, runs migrations, creates `McpServer`, connects `StdioServerTransport`. Opens in read-only mode (no write tools registered) to avoid WAL conflicts with running daemon.

**`src/index.ts`**

```typescript
export { createMcpServer } from "./server.js";
export type { McpServerOptions } from "./server.js";
export { createFastifyPlugin } from "./fastify-plugin.js";
```

---

### Step 7 — Wire Into Existing Daemon

**`packages/service/src/server.ts`**

Add `@agent-recorder/mcp-server` to `packages/service/package.json` dependencies.

In `createServer()`, after existing route registrations:

```typescript
import { createFastifyPlugin } from "@agent-recorder/mcp-server";

await app.register(
  createFastifyPlugin({
    db,
    redactKeys: redactKeys ?? [],
    contextBudgetTokens: contextBudgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS,
  })
);
```

No changes to `CreateServerOptions` interface needed — `db`, `redactKeys`, `contextBudgetTokens` already present.

---

### Step 8 — CLI Integration

**`packages/cli/src/commands/mcp-server.ts`** — replace entirely:

```typescript
export async function mcpServerStartCommand(): Promise<void>;
// If daemon running: print "/mcp endpoint URL" and exit
// If not: print "Start daemon first: agent-recorder start"

export async function mcpServerStatusCommand(): Promise<void>;
// Ping GET http://127.0.0.1:{port}/mcp (initialize request)
// Print URL if alive, "not running" otherwise

export async function mcpServerStdioCommand(): Promise<void>;
// Spawn stdio.js entry with process.execPath, pipe stdio through
```

**`packages/cli/src/index.ts`** — update `mcp-server` command registration to subcommands: `start`, `status`, and add `--stdio` flag on the parent command.

---

## Key Design Decisions

| Decision            | Choice                                                                           | Reason                                                                                              |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Existing MCP server | **Replace entirely** (`packages/cli/src/commands/mcp-server.ts`)                 | Hand-rolled, proxies REST (extra hop), binds `0.0.0.0`, superseded by 8 new tools                   |
| MCP SDK             | Add `@modelcontextprotocol/sdk` (new dep)                                        | Not currently installed; hand-rolling Streamable HTTP + SSE session lifecycle is error-prone        |
| Server mounting     | Fastify plugin on existing daemon at `/mcp`                                      | Shares SQLite instance directly, no REST proxy hop                                                  |
| `source` column     | New migration `008_add_source_column.sql`, default `'proxy'`                     | Distinguishes proxy-captured vs externally-ingested; backfills existing rows transparently          |
| Input validation    | Zod schema-first                                                                 | Single source of truth for runtime validation + TypeScript types                                    |
| Prompt stripping    | Strip before redact, write path only                                             | Remove key entirely (not `[REDACTED]`) — lost data is better than leaked data                       |
| Token roll-up       | Computed at query time in JS over flat `BaseEvent[]`                             | No materialized columns; `getEventsBySession()` returns flat array, `buildEventTree()` is new logic |
| Rate limiting       | In-memory token-bucket, keyed on **AR `session_id`** (not MCP transport session) | Prevents bypass on reconnect; PRD says "per session" = AR session                                   |
| STDIO transport     | Read-only (no write tools registered)                                            | Prevents WAL conflicts when daemon is also running                                                  |
| Pricing             | Static JSON, user-editable                                                       | No live API calls, all costs labeled `estimated_`                                                   |

---

## Privacy Guarantees

- **Prompt stripping** on write path: `prompt`, `system_prompt`, `reasoning`, `chain_of_thought`, `messages`, `thought`, `thinking` silently dropped from all write tool inputs before storage
- **Redaction** via `AR_REDACT_KEYS` applied to `input_preview`, `output_preview`, `metadata` values
- **Localhost-only:** Bound to `127.0.0.1`, consistent with existing daemon
- **Token counts, timestamps, event IDs, status** never redacted

---

## Files to Create

| File                                                      | Type                 |
| --------------------------------------------------------- | -------------------- |
| `packages/mcp-server/package.json`                        | New                  |
| `packages/mcp-server/tsconfig.json`                       | New                  |
| `packages/mcp-server/src/index.ts`                        | New                  |
| `packages/mcp-server/src/server.ts`                       | New                  |
| `packages/mcp-server/src/fastify-plugin.ts`               | New                  |
| `packages/mcp-server/src/stdio.ts`                        | New                  |
| `packages/mcp-server/src/rate-limiter.ts`                 | New                  |
| `packages/mcp-server/src/validation/schemas.ts`           | New                  |
| `packages/mcp-server/src/validation/redaction.ts`         | New                  |
| `packages/mcp-server/src/rollup/token-rollup.ts`          | New                  |
| `packages/mcp-server/src/pricing/config.ts`               | New                  |
| `packages/mcp-server/src/pricing/estimator.ts`            | New                  |
| `packages/mcp-server/src/tools/read/list-sessions.ts`     | New                  |
| `packages/mcp-server/src/tools/read/get-session.ts`       | New                  |
| `packages/mcp-server/src/tools/read/query-token-usage.ts` | New                  |
| `packages/mcp-server/src/tools/read/get-token-budget.ts`  | New                  |
| `packages/mcp-server/src/tools/read/list-upstreams.ts`    | New                  |
| `packages/mcp-server/src/tools/write/record-event.ts`     | New                  |
| `packages/mcp-server/src/tools/write/complete-event.ts`   | New                  |
| `packages/mcp-server/src/tools/write/record-batch.ts`     | New                  |
| `.storage/pricing.json`                                   | New (default config) |

## Files to Modify

| File                                                 | Change                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/core/migrations/008_add_source_column.sql` | **New** — `ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'proxy'`          |
| `packages/core/migrations/009_add_model_column.sql`  | **New** — `ALTER TABLE events ADD COLUMN model TEXT`                                    |
| `packages/types/src/storage.ts`                      | Add `source?: string`, `model?: string \| null` to `InsertEventInput`                   |
| `packages/types/src/events.ts`                       | Add `source: string`, `model: string \| null` to `BaseEvent`                            |
| `packages/core/src/db/events.ts`                     | Add `source` + `model` to `rowToEvent()` + `insertEvent()` SQL                          |
| `packages/core/src/db/sessions.ts`                   | Add `listSessionsSummary()`                                                             |
| `packages/core/src/db/token-metrics.ts`              | Add `queryTokenUsageAggregated()`                                                       |
| `packages/core/src/db/upstreams.ts`                  | New file — `listUpstreamActivity()`                                                     |
| `packages/core/src/db/index.ts`                      | Export new functions + `source`-aware types                                             |
| `packages/service/package.json`                      | Add `@agent-recorder/mcp-server` dependency                                             |
| `packages/service/src/server.ts`                     | Register `createFastifyPlugin`                                                          |
| `packages/cli/src/commands/mcp-server.ts`            | **Entirely replace** existing 521-line hand-rolled server with new subcommand structure |
| `packages/cli/src/index.ts`                          | Update `mcp-server` CLI wiring                                                          |

---

## Testing Strategy

All tests in `packages/mcp-server/src/**/*.test.ts` (auto-discovered by root vitest config).

**Unit tests (no DB):**

- `rollup/token-rollup.test.ts` — recursive sum math with hand-crafted event arrays
- `validation/schemas.test.ts` — boundary conditions (limit=100 passes, 101 fails; missing required fields)
- `validation/redaction.test.ts` — strips prompt/messages/reasoning, passes through non-sensitive keys
- `pricing/estimator.test.ts` — cost math for known token counts
- `rate-limiter.test.ts` — allows up to limit, blocks on +1, resets after window

**Integration tests (in-memory DB):**
Pattern: `openMemoryDatabase()` → `runMigrations()` → seed → call tool handler directly → assert response.

- `tools/read/list-sessions.test.ts` — pagination, status filter, since filter
- `tools/read/get-session.test.ts` — tree depth, token roll-up math, include_io=false strips JSON
- `tools/read/query-token-usage.test.ts` — each group_by dimension
- `tools/read/get-token-budget.test.ts` — percent_used formula
- `tools/read/list-upstreams.test.ts` — ordering by last_seen_at
- `tools/write/record-event.test.ts` — valid insert; stripped keys absent from DB
- `tools/write/complete-event.test.ts` — cross-session rejection; double-complete is no-op
- `tools/write/record-batch.test.ts` — atomic 5-event batch; >100 events rejected by schema

**End-to-end:**
`src/server.test.ts` — `createMcpServer(openMemoryDatabase())` + `InMemoryTransport` (SDK) → `tools/list` returns all 8 tool names → `tools/call ar_list_sessions` returns valid response.

---

## Verification

```bash
# 1. Build new package
pnpm --filter @agent-recorder/mcp-server build

# 2. All tests pass
pnpm test

# 3. Full project builds
pnpm build && pnpm lint && pnpm format:check

# 4. Start daemon
pnpm ar:start

# 5. Verify /mcp endpoint responds
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'

# 6. CLI commands
agent-recorder mcp-server status
agent-recorder mcp-server --stdio

# 7. Connect Claude Code to http://127.0.0.1:8787/mcp as MCP server
#    Verify all 8 tools appear in tool list
```

---

## Risks and Mitigations

| Risk                                              | Mitigation                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `StreamableHTTPServerTransport` session lifecycle | `Map<sessionId, transport>` in Fastify plugin, cleaned up on `onClose`                                   |
| `verbatimModuleSyntax` type imports               | Use `import type` for all type-only imports from `@agent-recorder/types`                                 |
| `noUncheckedIndexedAccess` in tree traversal      | Explicit null guards + `!` assertions consistent with existing `hooks.ts` pattern                        |
| STDIO + daemon WAL conflicts                      | STDIO entry opens DB read-only, no write tools registered                                                |
| Token roll-up performance at scale                | Default depth 10, max depth 10 enforced by Zod; consider materialized columns if >500 events proves slow |
| Pricing data staleness                            | All costs labeled `estimated_`, ship updated `pricing.json` with releases                                |
