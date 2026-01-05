/**
 * Hooks API endpoint - receives events from Claude Code hooks.
 *
 * This endpoint is called by the agent-recorder-hook handler script
 * which is configured in Claude Code's .claude/settings.json.
 */

import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  insertEvent,
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

/** Get or create a session by ID */
function getOrCreateSession(db: Database.Database, sessionId: string) {
  // Check if session exists
  const existing = getSessionById(db, sessionId);
  if (existing) {
    return existing;
  }

  // Create new session with the provided ID
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

  // Task tool = subagent call
  if (toolName === "Task") {
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

  // Receive hook events from Claude Code
  app.post<{ Body: HookEventPayload }>("/api/hooks", async (request, reply) => {
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

      // Handle different hook types
      switch (payload.hook_type) {
        case "PreToolUse": {
          // We record on PostToolUse to get the response, but we could
          // optionally record PreToolUse for "started" events
          if (debug) {
            console.log(
              `[hooks] PreToolUse: ${payload.tool_name} (not recording yet)`
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
          const sequence = allocateSequence(db, session.id);

          const eventInput: InsertEventInput = {
            id: randomUUID(),
            sessionId: session.id,
            parentEventId: null,
            sequence,
            eventType,
            agentRole: "main",
            agentName: "claude-code",
            toolName: cleanName,
            mcpMethod: "tools/call",
            upstreamKey: upstreamKey,
            startedAt: now,
            endedAt: now,
            status: "success", // PostToolUse only fires on success
            inputJson: payload.tool_input
              ? JSON.stringify(payload.tool_input)
              : null,
            outputJson: payload.tool_response
              ? JSON.stringify(payload.tool_response)
              : null,
          };

          const event = insertEvent(db, eventInput);

          if (debug) {
            console.log(
              `[hooks] Recorded ${eventType}: ${cleanName} (event ${event.id})`
            );
          }
          break;
        }

        case "Stop": {
          // Agent finished - could record session end metadata
          if (debug) {
            console.log(`[hooks] Stop: session ${payload.session_id}`);
          }
          break;
        }

        case "SubagentStop": {
          // Subagent finished - could update parent event
          if (debug) {
            console.log(
              `[hooks] SubagentStop: ${payload.subagent_type ?? "unknown"}`
            );
          }
          break;
        }

        case "SessionStart": {
          if (debug) {
            console.log(
              `[hooks] SessionStart: ${payload.session_id} (${payload.start_source ?? "unknown"})`
            );
          }
          break;
        }

        case "SessionEnd": {
          if (debug) {
            console.log(
              `[hooks] SessionEnd: ${payload.session_id} (${payload.end_reason ?? "unknown"})`
            );
            if (payload.statistics) {
              console.log(`[hooks] Statistics:`, payload.statistics);
            }
          }
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
  });

  // Health check for hooks endpoint
  app.get("/api/hooks/health", async () => {
    return { status: "ok", mode: "hooks" };
  });
}
