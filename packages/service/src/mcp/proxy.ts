/**
 * MCP Proxy using Streamable HTTP transport.
 * Handles POST requests only, returns application/json responses.
 * Records tools/call events to the database.
 */

import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { Config } from "@agent-recorder/core";
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  isToolsCallRequest,
  isErrorResponse,
} from "./types.js";
import { recordToolCall } from "./recorder.js";

/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Hop-by-hop headers that should not be forwarded */
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

export interface McpProxyOptions {
  db: Database.Database;
  config: Config;
  /** Session ID to use for recording events. If null, events won't be recorded. */
  sessionId: string | null;
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
}

export interface CreateMcpProxyResult {
  app: FastifyInstance;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Validate minimal JSON-RPC 2.0 request shape.
 * Returns error message if invalid, null if valid.
 */
function validateJsonRpcRequest(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be an object";
  }

  const obj = body as Record<string, unknown>;

  if (obj.jsonrpc !== "2.0") {
    return "Invalid JSON-RPC version (expected 2.0)";
  }

  if (typeof obj.method !== "string" || obj.method.length === 0) {
    return "Missing or invalid method";
  }

  return null;
}

/**
 * Build headers to forward to downstream, preserving safe headers.
 */
function buildForwardHeaders(
  requestHeaders: Record<string, string | string[] | undefined>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  for (const [key, value] of Object.entries(requestHeaders)) {
    const lowerKey = key.toLowerCase();

    // Skip hop-by-hop headers
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue;
    }

    // Skip content-type and accept (we set our own)
    if (lowerKey === "content-type" || lowerKey === "accept") {
      continue;
    }

    // Preserve authorization and other safe headers
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }

  return headers;
}

/**
 * Create an MCP proxy server.
 */
export async function createMcpProxy(
  options: McpProxyOptions
): Promise<CreateMcpProxyResult> {
  const { db, config, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const { downstreamMcpUrl, redactKeys, mcpProxyPort, debugProxy } = config;

  const app = Fastify({ logger: false });

  // Health check endpoint
  app.get("/health", async () => {
    return { status: "ok", proxy: true };
  });

  // MCP POST handler
  app.post("/", async (request, reply) => {
    // Validate downstream URL is configured
    if (!downstreamMcpUrl) {
      return reply.code(503).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Downstream MCP server not configured",
        },
        id: null,
      });
    }

    // Validate minimal JSON-RPC shape
    const validationError = validateJsonRpcRequest(request.body);
    if (validationError) {
      return reply.code(400).send({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: validationError,
        },
        id: null,
      });
    }

    const body = request.body as JsonRpcRequest;

    // Check if this is a tools/call request
    const isToolCall = isToolsCallRequest(body);
    const startedAt = new Date().toISOString();
    let toolName: string | null = null;
    let toolInput: unknown = null;

    if (isToolCall) {
      const params = body.params as { name: string; arguments?: unknown };
      toolName = params.name;
      toolInput = params.arguments ?? {};
    }

    // Build headers to forward
    const forwardHeaders = buildForwardHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Forward request to downstream
    let downstreamResponse: Response;
    try {
      downstreamResponse = await fetch(downstreamMcpUrl, {
        method: "POST",
        headers: forwardHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);

      // Check if this was a timeout
      if (error instanceof Error && error.name === "AbortError") {
        const endedAt = new Date().toISOString();

        // Record timeout if this was a tools/call
        if (isToolCall && toolName && sessionId) {
          recordToolCall({
            db,
            sessionId,
            toolName,
            mcpMethod: "tools/call",
            input: toolInput,
            output: { error: "Request timeout" },
            status: "timeout",
            startedAt,
            endedAt,
            redactKeys,
            debugProxy,
          });
        }

        return reply.code(504).send({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Request timeout",
            data: { category: "timeout" },
          },
          id: body.id ?? null,
        });
      }

      // Log without potentially sensitive data
      console.error("Failed to forward request to downstream");
      return reply.code(502).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Failed to connect to downstream MCP server",
        },
        id: body.id ?? null,
      });
    }

    clearTimeout(timeoutId);

    // Parse downstream response
    let responseBody: JsonRpcResponse;
    try {
      responseBody = (await downstreamResponse.json()) as JsonRpcResponse;
    } catch {
      console.error("Failed to parse downstream response");
      return reply.code(502).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Invalid response from downstream MCP server",
        },
        id: body.id ?? null,
      });
    }

    const endedAt = new Date().toISOString();

    // Record tool call event if this was a tools/call request and we have a session
    if (isToolCall && toolName && sessionId) {
      const status = isErrorResponse(responseBody) ? "error" : "success";
      const output = isErrorResponse(responseBody)
        ? responseBody.error
        : responseBody.result;

      recordToolCall({
        db,
        sessionId,
        toolName,
        mcpMethod: "tools/call",
        input: toolInput,
        output,
        status,
        startedAt,
        endedAt,
        redactKeys,
        debugProxy,
      });
    }

    // Preserve downstream HTTP status code and return response unchanged
    reply.code(downstreamResponse.status);
    reply.header("Content-Type", "application/json");
    return reply.send(responseBody);
  });

  const start = async () => {
    await app.listen({ port: mcpProxyPort, host: "127.0.0.1" });
    console.log(`MCP proxy listening on http://127.0.0.1:${mcpProxyPort}`);
  };

  const close = async () => {
    await app.close();
  };

  return { app, start, close };
}
