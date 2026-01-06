/**
 * STDIO Proxy telemetry endpoint.
 *
 * Receives telemetry from the STDIO proxy (agent-recorder-proxy).
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

interface StdioRoutesOptions {
  db: Database.Database;
  debug?: boolean;
}

/** STDIO proxy telemetry payload */
interface StdioTelemetryPayload {
  /** Timestamp when message was captured */
  timestamp: string;
  /** Direction: client → server or server → client */
  direction: "request" | "response";
  /** Raw JSON-RPC message */
  raw: string;
  /** Parsed method (if request) */
  method?: string;
  /** Parsed id (for correlation) */
  id?: string | number | null;
  /** Whether this is an error response */
  isError?: boolean;
  /** Session ID for correlation */
  sessionId?: string;
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

/** Parse tool name from JSON-RPC params */
function extractToolInfo(
  raw: string,
  method?: string
): { toolName: string | null; input: unknown } {
  try {
    const parsed = JSON.parse(raw) as {
      params?: { name?: string; arguments?: unknown };
    };
    if (method === "tools/call" && parsed.params?.name) {
      return {
        toolName: parsed.params.name,
        input: parsed.params.arguments,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { toolName: null, input: null };
}

export async function registerStdioRoutes(
  app: FastifyInstance,
  options: StdioRoutesOptions
): Promise<void> {
  const { db, debug = false } = options;

  // Receive telemetry from STDIO proxy
  app.post<{ Body: StdioTelemetryPayload }>(
    "/api/stdio",
    async (request, reply) => {
      try {
        const payload = request.body;

        if (debug) {
          console.log(
            `[stdio] Received ${payload.direction}: ${payload.method ?? "response"}`
          );
        }

        // Only record tool calls (not all MCP traffic)
        if (
          payload.direction === "request" &&
          payload.method === "tools/call"
        ) {
          const sessionId = payload.sessionId ?? "stdio-" + randomUUID();
          const session = getOrCreateSession(db, sessionId);
          const sequence = allocateSequence(db, session.id);

          const { toolName, input } = extractToolInfo(
            payload.raw,
            payload.method
          );

          const eventInput: InsertEventInput = {
            id: randomUUID(),
            sessionId: session.id,
            parentEventId: null,
            sequence,
            eventType: "tool_call",
            agentRole: "main",
            agentName: "mcp-client",
            toolName: toolName,
            mcpMethod: payload.method,
            upstreamKey: "stdio",
            startedAt: payload.timestamp,
            endedAt: null,
            status: "running",
            inputJson: input ? JSON.stringify(input) : null,
            outputJson: null,
          };

          insertEvent(db, eventInput);

          if (debug) {
            console.log(`[stdio] Recorded tool call: ${toolName}`);
          }
        }

        // TODO: Match responses to requests by id to update status and output

        return reply.code(200).send({ ok: true });
      } catch (error) {
        console.error("[stdio] Error processing telemetry:", error);
        // Fail open - don't block the proxy
        return reply.code(200).send({ ok: true, error: "logged" });
      }
    }
  );

  // Health check for stdio endpoint
  app.get("/api/stdio/health", async () => {
    return { status: "ok", mode: "stdio" };
  });
}
