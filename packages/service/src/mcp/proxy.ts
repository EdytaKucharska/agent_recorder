/**
 * MCP Proxy using Streamable HTTP transport.
 * Handles POST requests only, returns application/json responses.
 * Records tools/call events to the database.
 * Supports hub mode: aggregates multiple HTTP providers.
 */

import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { Config, HttpProvider } from "@agent-recorder/core";
import {
  readProvidersFile,
  getDefaultProvidersPath,
} from "@agent-recorder/core";
import { readFileSync } from "node:fs";
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  isToolsCallRequest,
  isErrorResponse,
} from "./types.js";
import { recordToolCall } from "./recorder.js";

/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Upstreams registry shape */
interface UpstreamsRegistry {
  [serverKey: string]: {
    url: string;
  };
}

/**
 * Load upstreams registry from file.
 * Returns empty object if file doesn't exist or is invalid.
 */
function loadUpstreamsRegistry(upstreamsPath: string): UpstreamsRegistry {
  try {
    const content = readFileSync(upstreamsPath, "utf-8");
    const registry = JSON.parse(content) as UpstreamsRegistry;
    return registry ?? {};
  } catch {
    // File doesn't exist or invalid JSON - return empty registry
    return {};
  }
}

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
    // Accept both JSON and SSE for MCP servers that use streaming (e.g., Figma)
    Accept: "application/json, text/event-stream",
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
 * Load HTTP providers from providers.json.
 * If no providers found and downstreamMcpUrl is set, creates implicit "default" provider.
 */
function loadHttpProviders(
  providersPath: string,
  downstreamMcpUrl: string | null
): HttpProvider[] {
  const providersFile = readProvidersFile(providersPath);
  const httpProviders = providersFile.providers.filter(
    (p): p is HttpProvider => p.type === "http"
  );

  // Fallback: if no providers and downstreamMcpUrl is set, create implicit default
  if (httpProviders.length === 0 && downstreamMcpUrl) {
    return [
      {
        id: "default",
        type: "http",
        url: downstreamMcpUrl,
      },
    ];
  }

  return httpProviders;
}

/**
 * Call tools/list on a single provider.
 * Returns tools array or null on error.
 */
async function fetchProviderTools(
  provider: HttpProvider,
  timeoutMs: number,
  debugProxy: boolean
): Promise<unknown[] | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(provider.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (debugProxy) {
        console.warn(
          `[Hub] Provider ${provider.id} tools/list failed: HTTP ${response.status}`
        );
      }
      return null;
    }

    const data = (await response.json()) as JsonRpcResponse;

    if (isErrorResponse(data)) {
      if (debugProxy) {
        console.warn(
          `[Hub] Provider ${provider.id} tools/list error: ${data.error.message}`
        );
      }
      return null;
    }

    const result = data.result;
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !("tools" in result)
    ) {
      if (debugProxy) {
        console.warn(
          `[Hub] Provider ${provider.id} tools/list result missing tools`
        );
      }
      return null;
    }

    const tools = (result as { tools: unknown }).tools;
    if (!Array.isArray(tools)) {
      if (debugProxy) {
        console.warn(
          `[Hub] Provider ${provider.id} tools/list returned non-array`
        );
      }
      return null;
    }

    return tools;
  } catch (error) {
    clearTimeout(timeoutId);
    if (debugProxy) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.warn(`[Hub] Provider ${provider.id} unreachable: ${msg}`);
    }
    return null;
  }
}

/**
 * Aggregate tools/list from all HTTP providers with namespacing.
 * Returns merged JSON-RPC response.
 */
async function aggregateToolsList(
  providers: HttpProvider[],
  requestId: string | number | null | undefined,
  timeoutMs: number,
  debugProxy: boolean
): Promise<JsonRpcResponse> {
  const allTools: unknown[] = [];

  // Fetch tools from each provider in parallel
  const results = await Promise.all(
    providers.map((p) => fetchProviderTools(p, timeoutMs, debugProxy))
  );

  // Merge results with namespacing
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const tools = results[i];

    if (!tools) {
      // Provider failed - skip but log
      if (debugProxy) {
        console.log(`[Hub] Omitting tools from ${provider.id} (failed)`);
      }
      continue;
    }

    // Namespace each tool with provider ID
    for (const tool of tools) {
      if (
        tool &&
        typeof tool === "object" &&
        !Array.isArray(tool) &&
        "name" in tool &&
        typeof tool.name === "string"
      ) {
        const namespacedTool = {
          ...tool,
          name: `${provider.id}.${tool.name}`,
        };
        allTools.push(namespacedTool);
      }
    }
  }

  return {
    jsonrpc: "2.0",
    result: { tools: allTools },
    id: requestId ?? null,
  };
}

/**
 * Parse namespaced tool name into provider ID and tool name.
 * Returns null if format is invalid.
 */
function parseNamespacedTool(
  name: string
): { providerId: string; toolName: string } | null {
  const dotIndex = name.indexOf(".");
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === name.length - 1) {
    return null;
  }

  return {
    providerId: name.slice(0, dotIndex),
    toolName: name.slice(dotIndex + 1),
  };
}

/**
 * Create an MCP proxy server.
 */
export async function createMcpProxy(
  options: McpProxyOptions
): Promise<CreateMcpProxyResult> {
  const { db, config, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const {
    downstreamMcpUrl,
    upstreamsPath,
    redactKeys,
    mcpProxyPort,
    debugProxy,
  } = config;

  // Load HTTP providers for hub mode
  const providersPath = getDefaultProvidersPath();
  const httpProviders = loadHttpProviders(providersPath, downstreamMcpUrl);

  if (debugProxy && httpProviders.length > 0) {
    console.log(
      `[Hub] Loaded ${httpProviders.length} HTTP provider(s):`,
      httpProviders.map((p) => p.id).join(", ")
    );
  }

  const app = Fastify({ logger: false });

  // Health check endpoint
  app.get("/health", async () => {
    return { status: "ok", proxy: true };
  });

  // MCP POST handler
  app.post("/", async (request, reply) => {
    // Parse upstream key from query param
    const upstreamKey =
      typeof request.query === "object" && request.query !== null
        ? (request.query as Record<string, unknown>).upstream
        : null;
    const upstreamKeyStr = typeof upstreamKey === "string" ? upstreamKey : null;

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

    // Hub mode: Handle tools/list by aggregating from all providers
    if (body.method === "tools/list" && httpProviders.length > 0) {
      const response = await aggregateToolsList(
        httpProviders,
        body.id,
        timeoutMs,
        debugProxy
      );
      return reply.code(200).send(response);
    }

    // Declare variables for tool call tracking
    const startedAt = new Date().toISOString();
    const isToolCall = isToolsCallRequest(body);
    let toolName: string | null = null;
    let toolInput: unknown = null;

    if (isToolCall) {
      const params = body.params as { name: string; arguments?: unknown };
      toolName = params.name;
      toolInput = params.arguments ?? {};
    }

    // Determine downstream URL based on router/hub mode logic
    let finalDownstreamUrl: string | null = null;
    let finalUpstreamKey: string | null = upstreamKeyStr;

    // Hub mode: Parse namespaced tool name for tools/call
    if (isToolCall && toolName && httpProviders.length > 0) {
      const parsed = parseNamespacedTool(toolName);

      if (parsed) {
        // Find provider by ID
        const provider = httpProviders.find((p) => p.id === parsed.providerId);

        if (!provider) {
          // Record error event with JSON-RPC error structure
          const errorMessage = `Cannot connect to Unknown provider: ${parsed.providerId}`;
          if (sessionId) {
            recordToolCall({
              db,
              sessionId,
              toolName: parsed.toolName,
              mcpMethod: "tools/call",
              upstreamKey: parsed.providerId,
              input: toolInput,
              output: {
                code: -32000,
                message: errorMessage,
              },
              status: "error",
              startedAt,
              endedAt: new Date().toISOString(),
              redactKeys,
              debugProxy,
            });
          }

          return reply.code(404).send({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: errorMessage,
              data: { category: "downstream_unreachable" },
            },
            id: body.id ?? null,
          });
        }

        // Route to provider URL
        finalDownstreamUrl = provider.url;
        finalUpstreamKey = parsed.providerId;
        // Rewrite tool name without namespace prefix
        toolName = parsed.toolName;
        (body.params as { name: string }).name = parsed.toolName;
      }
    }

    // Router mode: lookup upstream in registry
    if (!finalDownstreamUrl && upstreamKeyStr) {
      const registry = loadUpstreamsRegistry(upstreamsPath);
      const upstream = registry[upstreamKeyStr];

      if (!upstream) {
        return reply.code(404).send({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Unknown upstream: ${upstreamKeyStr}`,
          },
          id: null,
        });
      }

      finalDownstreamUrl = upstream.url;
    }

    // Legacy mode: use configured downstream URL
    if (!finalDownstreamUrl && downstreamMcpUrl) {
      finalDownstreamUrl = downstreamMcpUrl;
    }

    // No downstream configured
    if (!finalDownstreamUrl) {
      return reply.code(503).send({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Downstream MCP server not configured",
        },
        id: null,
      });
    }

    // Build headers to forward
    const forwardHeaders = buildForwardHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );

    // Log routing decision if debug enabled
    if (debugProxy) {
      console.log(
        `[PROXY] Routing ${body.method} to ${finalDownstreamUrl} (upstream: ${finalUpstreamKey ?? "legacy"})`
      );
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Forward request to downstream
    let downstreamResponse: Response;
    try {
      downstreamResponse = await fetch(finalDownstreamUrl, {
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
            upstreamKey: finalUpstreamKey,
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

      // Log error with details for debugging
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorName = error instanceof Error ? error.name : "Error";
      console.error(
        `Failed to forward request to downstream: ${errorName}: ${errorMessage}`
      );
      console.error(`  Target URL: ${finalDownstreamUrl}`);
      console.error(`  Upstream key: ${finalUpstreamKey ?? "(legacy mode)"}`);

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

    // Check response content type to handle SSE vs JSON
    const contentType = downstreamResponse.headers.get("content-type") ?? "";
    const isSSE = contentType.includes("text/event-stream");

    // Parse downstream response
    let responseBody: JsonRpcResponse;
    try {
      if (isSSE) {
        // Handle SSE response - extract JSON from the stream
        const text = await downstreamResponse.text();
        // SSE format: "event: message\ndata: {...}\n\n"
        // Extract the last complete JSON object from the data lines
        const dataLines = text
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6)); // Remove "data: " prefix

        if (dataLines.length === 0) {
          throw new Error("No data in SSE response");
        }

        // Use the last data line (final response)
        const lastData = dataLines[dataLines.length - 1];
        responseBody = JSON.parse(lastData!) as JsonRpcResponse;
      } else {
        responseBody = (await downstreamResponse.json()) as JsonRpcResponse;
      }
    } catch (parseError) {
      console.error("Failed to parse downstream response");
      if (debugProxy) {
        console.error(
          "  Parse error:",
          parseError instanceof Error ? parseError.message : "Unknown"
        );
        console.error("  Content-Type:", contentType);
      }
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
        upstreamKey: finalUpstreamKey,
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
