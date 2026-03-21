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
  deriveErrorCategory,
  type InsertEventInput,
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
      tool_response: {},
      subagent_type: { type: "string" as const },
      message: { type: "string" as const },
      start_source: { type: "string" as const },
      end_reason: { type: "string" as const },
      statistics: { type: "object" as const },
    },
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

/** Format tool call for logging */
function formatToolCallLog(
  toolName: string,
  upstreamKey: string | null,
  input: Record<string, unknown> | undefined,
  output: unknown | undefined
): string {
  const server = upstreamKey ?? "builtin";
  const inputSummary = input ? truncateForLog(input, 150) : "(no input)";
  const outputSummary = output ? truncateForLog(output, 150) : "(no output)";

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
 * Checks for MCP-style isError, top-level error fields, and error-like structures.
 */
function isToolResponseError(response: unknown): boolean {
  if (response === null || response === undefined) return false;
  if (typeof response !== "object" || Array.isArray(response)) return false;

  const obj = response as Record<string, unknown>;

  // MCP tool result: { isError: true }
  if (obj.isError === true) return true;

  // Top-level error field (JSON-RPC style or generic)
  if ("error" in obj && obj.error !== null && obj.error !== undefined) {
    return true;
  }

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
  const sessionContexts = new Map<string, SessionContext>();

  /** Evict stale session contexts that exceed TTL */
  function evictStaleContexts(): void {
    const now = Date.now();
    for (const [id, ctx] of sessionContexts) {
      if (now - ctx.lastActivityAt > SESSION_CONTEXT_TTL_MS) {
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
        sessionContexts.delete(entries[i]![0]);
      }
    }
  }

  function getSessionContext(sessionId: string): SessionContext {
    let ctx = sessionContexts.get(sessionId);
    if (!ctx) {
      // Evict stale entries before adding new ones
      evictStaleContexts();
      ctx = {
        agentCallEventId: null,
        parentStack: [],
        lastActivityAt: Date.now(),
      };
      sessionContexts.set(sessionId, ctx);
    } else {
      ctx.lastActivityAt = Date.now();
    }
    return ctx;
  }

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

        // Handle different hook types
        switch (payload.hook_type) {
          case "SessionStart": {
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
              break;
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
              startedAt: now,
              status: "running",
              inputJson: payload.tool_input
                ? redactAndTruncate(payload.tool_input, redactKeys)
                : null,
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
              return reply.code(400).send({ error: "Missing tool_name" });
            }

            const { eventType, cleanName, upstreamKey } = parseToolName(
              payload.tool_name
            );
            const now = new Date().toISOString();

            // Determine status from tool response
            const responseIsError = isToolResponseError(payload.tool_response);
            const eventStatus: import("@agent-recorder/core").EventStatus =
              responseIsError ? "error" : "success";
            const outputJsonStr = payload.tool_response
              ? redactAndTruncate(payload.tool_response, redactKeys)
              : null;
            const errorCategory = responseIsError
              ? deriveErrorCategory(eventStatus, outputJsonStr)
              : null;

            // Try to find the matching "running" event from PreToolUse.
            // Note: findRunningEvent returns the most recent match by toolName,
            // which may be incorrect if parallel tools share the same name.
            // See packages/core/src/db/events.ts for the caveat documentation.
            const runningEvent = findRunningEvent(db, session.id, cleanName);

            if (runningEvent) {
              // Complete the existing running event
              completeEvent(
                db,
                runningEvent.id,
                eventStatus,
                now,
                outputJsonStr,
                errorCategory
              );

              // Pop from parent stack if this was a subagent/skill
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
                inputJson: payload.tool_input
                  ? redactAndTruncate(payload.tool_input, redactKeys)
                  : null,
                outputJson: outputJsonStr,
                errorCategory,
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
                `[hooks] ${formatToolCallLog(cleanName, upstreamKey, payload.tool_input, payload.tool_response)}`
              );
            }
            break;
          }

          case "Stop": {
            // Agent finished — complete the root agent_call
            if (ctx.agentCallEventId) {
              const now = new Date().toISOString();
              completeEvent(db, ctx.agentCallEventId, "success", now);
              if (debug) {
                console.log(
                  `[hooks] Stop: completed agent_call ${ctx.agentCallEventId}`
                );
              }
              // Clear to prevent double-completion in SessionEnd
              ctx.agentCallEventId = null;
            }
            break;
          }

          case "SubagentStop": {
            // Find and remove the matching subagent from the parent stack.
            // Search from the top (most recent) to handle nested subagents.
            if (ctx.parentStack.length > 0) {
              // If we have a tool_name hint, match by toolName stored in the
              // stack entry (pure in-memory lookup, no DB queries needed).
              // Otherwise fall back to the top of the stack.
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
              const now = new Date().toISOString();
              completeEvent(db, matchedEntry.id, "success", now);
              if (debug) {
                console.log(
                  `[hooks] SubagentStop: completed ${matchedEntry.id} (${payload.subagent_type ?? "unknown"})`
                );
              }
            }
            break;
          }

          case "SessionEnd": {
            // End the root agent_call and clean up
            if (ctx.agentCallEventId) {
              const now = new Date().toISOString();
              const eventStatus: import("@agent-recorder/core").EventStatus =
                payload.end_reason === "error" ? "error" : "success";
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
            const now = new Date().toISOString();
            const sessionStatus: import("@agent-recorder/core").SessionStatus =
              payload.end_reason === "error" ? "error" : "completed";
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
