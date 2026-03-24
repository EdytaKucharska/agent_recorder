/**
 * Hooks API endpoint - receives events from Claude Code hooks.
 *
 * This endpoint is called by the agent-recorder-hook handler script
 * which is configured in Claude Code's .claude/settings.json.
 *
 * Implements hierarchical event tracking:
 * - SessionStart → creates agent_call event (root of the tree)
 * - PreToolUse → creates event with status "running" (captures start time)
 * - PostToolUse → completes the running event with output and end time
 * - SessionEnd → ends the agent_call event
 */

import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  insertEvent,
  completeEvent,
  findRunningEvent,
  endSession,
  createSession,
  getSessionById,
  allocateSequence,
  redactAndTruncate,
  redactJson,
  deriveErrorCategory,
  estimateTokens,
  type InsertEventInput,
  type EventStatus,
  type SessionStatus,
} from "@agent-recorder/core";

interface HooksRoutesOptions {
  db: Database.Database;
  debug?: boolean;
  redactKeys?: string[];
}

/** Hook event from Claude Code (via handler script) */
interface HookEventPayload {
  hook_type: string;
  session_id: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  subagent_type?: string;
  message?: string;
  start_source?: string;
  end_reason?: string;
  statistics?: {
    duration_ms?: number;
    tool_calls?: number;
    tokens_used?: number;
  };
}

/**
 * Per-session context stack for tracking event hierarchy.
 * Maps session_id → { agentCallEventId, parentStack }
 */
interface ParentStackEntry {
  id: string;
  toolName: string;
}

interface SessionContext {
  /** Root agent_call event ID for this session */
  agentCallEventId: string | null;
  /** Stack of active parent event IDs (subagent/skill calls) */
  parentStack: ParentStackEntry[];
  /** Timestamp of last activity (for TTL eviction) */
  lastActivityAt: number;
}

/** Max age for session contexts before TTL eviction (1 hour) */
const SESSION_CONTEXT_TTL_MS = 60 * 60 * 1000;
/** Maximum number of tracked sessions to prevent unbounded growth */
const SESSION_CONTEXT_MAX_SIZE = 500;

/** Fastify JSON schema for hook event validation (module-level constant) */
const hookEventSchema = {
  body: {
    type: "object" as const,
    required: ["hook_type", "session_id"],
    properties: {
      hook_type: { type: "string" as const },
      session_id: { type: "string" as const },
      transcript_path: { type: "string" as const },
      tool_name: { type: "string" as const },
      tool_input: { type: "object" as const },
      // Empty schema: tool responses are arbitrary (strings, objects, arrays, etc.)
      // so we intentionally accept any JSON value here.
      tool_response: {},
      subagent_type: { type: "string" as const },
      message: { type: "string" as const },
      start_source: { type: "string" as const },
      end_reason: { type: "string" as const },
      statistics: { type: "object" as const },
    },
    // No additionalProperties: false here — hook payloads must be forward-
    // compatible. If Claude Code ships new fields (e.g. correlation_id),
    // rejecting them would silently drop the entire payload via the
    // fail-open error handler, with no recording and no warning.
    // The required-fields check (["hook_type", "session_id"]) provides
    // the meaningful validation.
  },
};

/** Get the current parent event ID from the context stack */
function getCurrentParentId(ctx: SessionContext): string | null {
  if (ctx.parentStack.length > 0) {
    return ctx.parentStack[ctx.parentStack.length - 1]!.id;
  }
  return ctx.agentCallEventId;
}

/** Truncate a string for logging */
function truncateForLog(value: unknown, maxLength = 100): string {
  if (value === null || value === undefined) return "(none)";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/** Format tool call for logging, with redaction applied to prevent
 * sensitive keys from appearing in daemon logs. */
function formatToolCallLog(
  toolName: string,
  upstreamKey: string | null,
  input: Record<string, unknown> | undefined,
  output: unknown | undefined,
  redactKeys: string[]
): string {
  const server = upstreamKey ?? "builtin";
  // Use redactJson (returns object) instead of redactAndTruncate (returns string)
  // to avoid double-serialization when truncateForLog calls JSON.stringify.
  const inputSummary = input
    ? truncateForLog(
        redactKeys.length > 0 ? redactJson(input, redactKeys) : input,
        150
      )
    : "(no input)";
  const outputSummary = output
    ? truncateForLog(
        redactKeys.length > 0 ? redactJson(output, redactKeys) : output,
        150
      )
    : "(no output)";

  return `[${server}] ${toolName}\n  Input:  ${inputSummary}\n  Output: ${outputSummary}`;
}

/** Get or create a session by ID */
function getOrCreateSession(db: Database.Database, sessionId: string) {
  const existing = getSessionById(db, sessionId);
  if (existing) {
    return existing;
  }
  const now = new Date().toISOString();
  return createSession(db, sessionId, now);
}

/**
 * Detect if a tool response indicates an error.
 * Only uses the MCP-standard `isError: true` field for status decisions.
 *
 * Previous versions also checked for a top-level `error` field (JSON-RPC
 * style), but this produced false positives for tools that use `error` as
 * a regular output field (e.g. `{ error: "none" }`). The `error` field is
 * now treated as informational metadata only — it is still captured in
 * outputJson for display but does not flip event status to "error".
 *
 * @internal Exported for unit testing only.
 */
export function isToolResponseError(response: unknown): boolean {
  if (response === null || response === undefined) return false;
  if (typeof response !== "object" || Array.isArray(response)) return false;

  const obj = response as Record<string, unknown>;

  // MCP tool result: { isError: true } — the only reliable signal
  if (obj.isError === true) return true;

  return false;
}

/** Map Claude Code tool names to our event model */
function parseToolName(toolName: string): {
  eventType: "tool_call" | "subagent_call" | "skill_call";
  cleanName: string;
  upstreamKey: string | null;
} {
  // MCP tool names are prefixed with "mcp__<server>__<tool>"
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 3) {
      const serverKey = parts[1];
      const mcpToolName = parts.slice(2).join("__");
      return {
        eventType: "tool_call",
        cleanName: mcpToolName ?? toolName,
        upstreamKey: serverKey ?? null,
      };
    }
  }

  // Agent tool = subagent call
  if (toolName === "Task" || toolName === "Agent") {
    return {
      eventType: "subagent_call",
      cleanName: toolName,
      upstreamKey: null,
    };
  }

  // Skill tool = skill call
  if (toolName === "Skill") {
    return {
      eventType: "skill_call",
      cleanName: toolName,
      upstreamKey: null,
    };
  }

  // Built-in tools (Bash, Read, Write, Edit, Glob, Grep, etc.)
  return {
    eventType: "tool_call",
    cleanName: toolName,
    upstreamKey: "builtin",
  };
}

export async function registerHooksRoutes(
  app: FastifyInstance,
  options: HooksRoutesOptions
): Promise<void> {
  const { db, debug = false, redactKeys = [] } = options;

  // Session contexts are scoped to this registration — not a module-level global.
  // Each call to registerHooksRoutes gets its own isolated map.
  //
  // Note: restart recovery is not supported. If the daemon restarts while a
  // session is active, the in-memory context is lost. Subsequent hooks for
  // the same session_id will create a fresh context with no parent chain,
  // and tool events will appear as disconnected root events. The "before
  // SessionStart" warning below covers this case.
  const sessionContexts = new Map<string, SessionContext>();

  /**
   * Complete orphaned running events when a session context is evicted.
   * If SessionEnd never fires (process killed, crash), running events
   * would remain in "running" status indefinitely. This sweeps them
   * with status "error" so the timeline reflects the abnormal termination.
   */
  function completeOrphanedEvents(ctx: SessionContext): void {
    const now = new Date().toISOString();
    // Complete any events remaining on the parent stack
    for (const entry of ctx.parentStack) {
      completeEvent(db, entry.id, "error", now);
    }
    // Complete the root agent_call
    if (ctx.agentCallEventId) {
      completeEvent(db, ctx.agentCallEventId, "error", now);
    }
  }

  /** Evict stale session contexts that exceed TTL.
   * Called periodically via setInterval to prevent stale entries from
   * accumulating during idle periods. Orphaned running events in the DB
   * are completed with "error" status before the context is discarded. */
  function evictStaleContexts(): void {
    const now = Date.now();
    for (const [id, ctx] of sessionContexts) {
      if (now - ctx.lastActivityAt > SESSION_CONTEXT_TTL_MS) {
        completeOrphanedEvents(ctx);
        sessionContexts.delete(id);
      }
    }
    // Hard cap: if still over max, remove oldest entries
    if (sessionContexts.size > SESSION_CONTEXT_MAX_SIZE) {
      const entries = [...sessionContexts.entries()].sort(
        (a, b) => a[1].lastActivityAt - b[1].lastActivityAt
      );
      const toRemove = entries.length - SESSION_CONTEXT_MAX_SIZE;
      for (let i = 0; i < toRemove; i++) {
        const entry = entries[i]!;
        completeOrphanedEvents(entry[1]);
        sessionContexts.delete(entry[0]);
      }
    }
  }

  function getSessionContext(sessionId: string): SessionContext {
    let ctx = sessionContexts.get(sessionId);
    if (!ctx) {
      ctx = {
        agentCallEventId: null,
        parentStack: [],
        lastActivityAt: Date.now(),
      };
      sessionContexts.set(sessionId, ctx);
      // Evict if cap exceeded — prevents unbounded growth between
      // periodic interval ticks under high session creation rates.
      if (sessionContexts.size > SESSION_CONTEXT_MAX_SIZE) {
        evictStaleContexts();
      }
    } else {
      ctx.lastActivityAt = Date.now();
    }
    return ctx;
  }

  // Periodic eviction prevents stale contexts from accumulating when
  // the daemon is idle (no new sessions triggering on-demand eviction).
  const evictionInterval = setInterval(
    evictStaleContexts,
    SESSION_CONTEXT_TTL_MS / 2
  );
  app.addHook("onClose", () => {
    clearInterval(evictionInterval);
    // On graceful shutdown, complete any orphaned running events so they
    // don't remain in "running" status permanently in the DB.
    for (const ctx of sessionContexts.values()) {
      completeOrphanedEvents(ctx);
    }
    sessionContexts.clear();
  });

  // Receive hook events from Claude Code
  app.post<{ Body: HookEventPayload }>(
    "/api/hooks",
    { schema: hookEventSchema },
    async (request, reply) => {
      const startTime = Date.now();

      try {
        const payload = request.body;

        if (debug) {
          console.log(
            `[hooks] Received ${payload.hook_type} for session ${payload.session_id}`
          );
        }

        // Ensure session exists
        const session = getOrCreateSession(db, payload.session_id);
        const ctx = getSessionContext(payload.session_id);

        // Warn if a tool/end hook arrives before SessionStart.
        // The session row exists (getOrCreateSession handles that) but
        // ctx.agentCallEventId will be null, so tool events will have no
        // parent and appear as disconnected root events.
        if (
          !ctx.agentCallEventId &&
          payload.hook_type !== "SessionStart" &&
          payload.hook_type !== "Stop"
        ) {
          console.warn(
            `[hooks] ${payload.hook_type} received for session ${payload.session_id} before SessionStart — tool events will lack parent context`
          );
        }

        // Handle different hook types
        switch (payload.hook_type) {
          case "SessionStart": {
            // If context already has an agent_call (double SessionStart, e.g.
            // daemon restart where old context wasn't evicted), complete the
            // old event so it doesn't stay "running" indefinitely in the DB.
            if (ctx.agentCallEventId) {
              completeOrphanedEvents(ctx);
              ctx.parentStack = [];
              if (debug) {
                console.warn(
                  `[hooks] SessionStart: completing orphaned agent_call ${ctx.agentCallEventId} from previous session start`
                );
              }
            }

            // Create root agent_call event for this session
            const sequence = allocateSequence(db, session.id);
            const now = new Date().toISOString();
            const agentCallId = randomUUID();

            const eventInput: InsertEventInput = {
              id: agentCallId,
              sessionId: session.id,
              parentEventId: null,
              sequence,
              eventType: "agent_call",
              agentRole: "main",
              agentName: "claude-code",
              startedAt: now,
              status: "running",
              inputJson: payload.start_source
                ? JSON.stringify({ source: payload.start_source })
                : null,
            };

            insertEvent(db, eventInput);
            ctx.agentCallEventId = agentCallId;

            if (debug) {
              console.log(
                `[hooks] SessionStart: created agent_call ${agentCallId} (${payload.start_source ?? "unknown"})`
              );
            }
            break;
          }

          case "PreToolUse": {
            if (!payload.tool_name) {
              // Fail open — never block Claude with a 400
              console.warn(
                `[hooks] PreToolUse missing tool_name for session ${payload.session_id}`
              );
              return reply
                .code(200)
                .send({ ok: true, warning: "missing_tool_name" });
            }

            const { eventType, cleanName, upstreamKey } = parseToolName(
              payload.tool_name
            );
            const now = new Date().toISOString();
            const sequence = allocateSequence(db, session.id);
            const eventId = randomUUID();

            // Determine MCP method from tool input if available
            let mcpMethod = "tools/call";
            if (payload.tool_input?.method) {
              mcpMethod = String(payload.tool_input.method);
            }

            const parentId = getCurrentParentId(ctx);

            const inputJson = payload.tool_input
              ? redactAndTruncate(payload.tool_input, redactKeys)
              : null;

            const eventInput: InsertEventInput = {
              id: eventId,
              sessionId: session.id,
              parentEventId: parentId,
              sequence,
              eventType,
              agentRole: "main",
              agentName: "claude-code",
              toolName: cleanName,
              mcpMethod,
              upstreamKey,
              // correlationId: not yet populated — Claude Code's hook API
              // does not expose a correlation ID. The DB column (migration 007)
              // and findRunningEvent support are ready; set this field once
              // the hook payload includes a correlation identifier.
              startedAt: now,
              status: "running",
              inputJson,
              inputTokens: inputJson != null ? estimateTokens(inputJson) : null,
            };

            insertEvent(db, eventInput);

            // Push subagent/skill calls onto the parent stack
            if (eventType === "subagent_call" || eventType === "skill_call") {
              ctx.parentStack.push({ id: eventId, toolName: cleanName });
            }

            if (debug) {
              console.log(
                `[hooks] PreToolUse: created ${eventType} ${cleanName} (${eventId}, parent: ${parentId ?? "root"})`
              );
            }
            break;
          }

          case "PostToolUse": {
            if (!payload.tool_name) {
              // Fail open — never block Claude with a 400
              console.warn(
                `[hooks] PostToolUse missing tool_name for session ${payload.session_id}`
              );
              return reply
                .code(200)
                .send({ ok: true, warning: "missing_tool_name" });
            }

            const { eventType, cleanName, upstreamKey } = parseToolName(
              payload.tool_name
            );
            const now = new Date().toISOString();

            // Determine status from tool response
            const responseIsError = isToolResponseError(payload.tool_response);
            const eventStatus: EventStatus = responseIsError
              ? "error"
              : "success";
            const outputJsonStr = payload.tool_response
              ? redactAndTruncate(payload.tool_response, redactKeys)
              : null;
            const errorCategory = responseIsError
              ? deriveErrorCategory(eventStatus, outputJsonStr)
              : null;

            // Try to find the matching "running" event from PreToolUse.
            // Invariant: both PreToolUse and PostToolUse receive the same
            // payload.tool_name, so parseToolName produces the same cleanName
            // in both hooks. This holds for MCP namespaced tools too
            // (e.g. "mcp__fs__read_file" → cleanName "read_file").
            // Note: findRunningEvent returns the most recent match by toolName,
            // which may be incorrect if parallel tools share the same name.
            // See packages/core/src/db/events.ts for the caveat documentation.
            const runningEvent = findRunningEvent(db, session.id, cleanName);

            const outputTokens =
              outputJsonStr != null ? estimateTokens(outputJsonStr) : null;

            if (runningEvent) {
              // Complete the existing running event
              const completed = completeEvent(
                db,
                runningEvent.id,
                eventStatus,
                now,
                outputJsonStr,
                errorCategory,
                outputTokens
              );

              if (!completed && debug) {
                console.warn(
                  `[hooks] PostToolUse: completeEvent returned null for ${runningEvent.id} — already completed?`
                );
              }

              // Pop from parent stack if still present. SubagentStop may
              // have already removed this entry; the splice is a safe no-op
              // if the entry is not found.
              if (eventType === "subagent_call" || eventType === "skill_call") {
                for (let i = ctx.parentStack.length - 1; i >= 0; i--) {
                  if (ctx.parentStack[i]!.id === runningEvent.id) {
                    ctx.parentStack.splice(i, 1);
                    break;
                  }
                }
              }

              if (debug) {
                console.log(
                  `[hooks] PostToolUse: completed ${eventType} ${cleanName} (${runningEvent.id}, status: ${eventStatus})`
                );
              }
            } else {
              // No matching PreToolUse — create a standalone completed event (backwards compat)
              const sequence = allocateSequence(db, session.id);
              const parentId = getCurrentParentId(ctx);

              let mcpMethod = "tools/call";
              if (payload.tool_input?.method) {
                mcpMethod = String(payload.tool_input.method);
              }

              const standaloneInputJson = payload.tool_input
                ? redactAndTruncate(payload.tool_input, redactKeys)
                : null;

              const eventInput: InsertEventInput = {
                id: randomUUID(),
                sessionId: session.id,
                parentEventId: parentId,
                sequence,
                eventType,
                agentRole: "main",
                agentName: "claude-code",
                toolName: cleanName,
                mcpMethod,
                upstreamKey,
                startedAt: now,
                endedAt: now,
                status: eventStatus,
                inputJson: standaloneInputJson,
                outputJson: outputJsonStr,
                errorCategory,
                inputTokens:
                  standaloneInputJson != null
                    ? estimateTokens(standaloneInputJson)
                    : null,
                outputTokens,
              };

              insertEvent(db, eventInput);

              if (debug) {
                console.log(
                  `[hooks] PostToolUse: standalone ${eventType} ${cleanName} (no matching PreToolUse, status: ${eventStatus})`
                );
              }
            }

            // Always log MCP tool calls with details
            const isMcpTool = upstreamKey && upstreamKey !== "builtin";
            if (isMcpTool || debug) {
              console.log(
                `[hooks] ${formatToolCallLog(cleanName, upstreamKey, payload.tool_input, payload.tool_response, redactKeys)}`
              );
            }
            break;
          }

          case "Stop": {
            // Stop fires for both normal completions and user cancellations.
            // It does not carry an end_reason, so we cannot determine the
            // actual outcome here. SessionEnd always follows Stop and has the
            // authoritative end_reason, so we defer agent_call completion to
            // SessionEnd to avoid status inconsistency (e.g. "cancelled"
            // agent_call with "completed" session).
            //
            // If SessionEnd never fires (e.g. Claude Code crash), running
            // events and parent stack entries remain until TTL eviction,
            // at which point completeOrphanedEvents() closes them with
            // status "error". SessionEnd is the authoritative cleanup path.
            if (debug && ctx.agentCallEventId) {
              console.log(
                `[hooks] Stop: agent_call ${ctx.agentCallEventId} completion deferred to SessionEnd`
              );
            }
            break;
          }

          case "SubagentStop": {
            // Pop the matching subagent from the parent stack so that
            // subsequent tool calls are no longer nested under it.
            // Does NOT complete the event — PostToolUse handles completion
            // with the actual output and error status from the tool response.
            //
            // Known limitation: matching is by tool name (e.g. "Agent").
            // If two nested subagents share the same name, this pops the
            // most-recent match, which may be the inner one when the outer
            // one's SubagentStop fires first. Claude Code's hook API does
            // not expose a correlation ID, so full correctness for this
            // edge case is not achievable. See also the findRunningEvent
            // caveat in packages/core/src/db/events.ts.
            if (ctx.parentStack.length > 0) {
              let matchIdx = ctx.parentStack.length - 1;

              if (payload.tool_name) {
                const { cleanName } = parseToolName(payload.tool_name);
                for (let i = ctx.parentStack.length - 1; i >= 0; i--) {
                  if (ctx.parentStack[i]!.toolName === cleanName) {
                    matchIdx = i;
                    break;
                  }
                }
              }

              const matchedEntry = ctx.parentStack[matchIdx]!;
              ctx.parentStack.splice(matchIdx, 1);
              if (debug) {
                console.log(
                  `[hooks] SubagentStop: popped ${matchedEntry.id} from parent stack (${payload.subagent_type ?? "unknown"}), completion deferred to PostToolUse`
                );
              }
            }
            break;
          }

          case "SessionEnd": {
            const now = new Date().toISOString();

            // Map end_reason to event and session status.
            // Claude Code may send "completed", "error", or "cancelled" (Ctrl-C).
            const eventStatus: EventStatus =
              payload.end_reason === "error"
                ? "error"
                : payload.end_reason === "cancelled"
                  ? "cancelled"
                  : "success";
            const sessionStatus: SessionStatus =
              payload.end_reason === "error"
                ? "error"
                : payload.end_reason === "cancelled"
                  ? "cancelled"
                  : "completed";

            // Complete any events still on the parent stack (interrupted
            // subagents/skills that never received PostToolUse).
            for (const entry of ctx.parentStack) {
              completeEvent(db, entry.id, eventStatus, now);
            }
            ctx.parentStack.length = 0;

            // End the root agent_call and clean up
            if (ctx.agentCallEventId) {
              completeEvent(db, ctx.agentCallEventId, eventStatus, now);

              if (debug) {
                console.log(
                  `[hooks] SessionEnd: ${payload.session_id} (${payload.end_reason ?? "unknown"})`
                );
                if (payload.statistics) {
                  console.log(`[hooks] Statistics:`, payload.statistics);
                }
              }
            }

            // End the session in the database
            endSession(db, session.id, now, sessionStatus);

            // Clean up context
            sessionContexts.delete(payload.session_id);
            break;
          }

          default: {
            if (debug) {
              console.log(`[hooks] Unknown hook type: ${payload.hook_type}`);
            }
          }
        }

        const elapsed = Date.now() - startTime;
        if (debug) {
          console.log(`[hooks] Processed in ${elapsed}ms`);
        }

        return reply.code(200).send({ ok: true });
      } catch (error) {
        console.error("[hooks] Error processing hook event:", error);
        // Fail open - return 200 to not block Claude
        return reply.code(200).send({ ok: true, error: "logged" });
      }
    }
  );

  // Health check for hooks endpoint
  app.get("/api/hooks/health", async () => {
    return { status: "ok", mode: "hooks" };
  });
}
