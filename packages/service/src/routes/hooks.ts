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
  type InsertEventInput,
} from "@agent-recorder/core";

interface HooksRoutesOptions {
  db: Database.Database;
  debug?: boolean;
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
interface SessionContext {
  /** Root agent_call event ID for this session */
  agentCallEventId: string | null;
  /** Stack of active parent event IDs (subagent/skill calls) */
  parentStack: string[];
}

const sessionContexts = new Map<string, SessionContext>();

function getSessionContext(sessionId: string): SessionContext {
  let ctx = sessionContexts.get(sessionId);
  if (!ctx) {
    ctx = { agentCallEventId: null, parentStack: [] };
    sessionContexts.set(sessionId, ctx);
  }
  return ctx;
}

/** Get the current parent event ID from the context stack */
function getCurrentParentId(ctx: SessionContext): string | null {
  if (ctx.parentStack.length > 0) {
    return ctx.parentStack[ctx.parentStack.length - 1]!;
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
  const { db, debug = false } = options;

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
                ? JSON.stringify(payload.tool_input)
                : null,
            };

            insertEvent(db, eventInput);

            // Push subagent/skill calls onto the parent stack
            if (eventType === "subagent_call" || eventType === "skill_call") {
              ctx.parentStack.push(eventId);
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

            // Try to find the matching "running" event from PreToolUse
            const runningEvent = findRunningEvent(db, session.id, cleanName);

            if (runningEvent) {
              // Complete the existing running event
              const outputJson = payload.tool_response
                ? JSON.stringify(payload.tool_response)
                : null;

              completeEvent(db, runningEvent.id, "success", now, outputJson);

              // Pop from parent stack if this was a subagent/skill
              if (eventType === "subagent_call" || eventType === "skill_call") {
                const idx = ctx.parentStack.lastIndexOf(runningEvent.id);
                if (idx !== -1) {
                  ctx.parentStack.splice(idx, 1);
                }
              }

              if (debug) {
                console.log(
                  `[hooks] PostToolUse: completed ${eventType} ${cleanName} (${runningEvent.id})`
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
                status: "success",
                inputJson: payload.tool_input
                  ? JSON.stringify(payload.tool_input)
                  : null,
                outputJson: payload.tool_response
                  ? JSON.stringify(payload.tool_response)
                  : null,
              };

              insertEvent(db, eventInput);

              if (debug) {
                console.log(
                  `[hooks] PostToolUse: standalone ${eventType} ${cleanName} (no matching PreToolUse)`
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
            }
            break;
          }

          case "SubagentStop": {
            // Pop the most recent subagent from the parent stack
            if (ctx.parentStack.length > 0) {
              const lastId = ctx.parentStack.pop()!;
              const now = new Date().toISOString();
              completeEvent(db, lastId, "success", now);
              if (debug) {
                console.log(
                  `[hooks] SubagentStop: completed ${lastId} (${payload.subagent_type ?? "unknown"})`
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
            endSession(db, session.id, now, "completed");

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
