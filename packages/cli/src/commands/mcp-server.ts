/**
 * MCP Server command - exposes Agent Recorder observability tools via MCP protocol.
 * Uses Streamable HTTP transport (JSON-RPC 2.0 over HTTP POST).
 * Binds to 127.0.0.1 by default; pass --host 0.0.0.0 explicitly to expose it
 * (e.g. for ngrok tunneling). The server has no authentication, so a
 * non-loopback bind makes recorded session data readable by the network.
 */

import * as http from "node:http";
import { getActualListenPort } from "@agent-recorder/core";

const DAEMON_NOT_RUNNING_MSG =
  "Agent Recorder daemon not running. Start with: agent-recorder start";

interface Session {
  id: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
}

interface BaseEvent {
  sequence: number;
  eventType: string;
  status: string;
  toolName?: string | null;
  skillName?: string | null;
  errorCategory?: string | null;
  startedAt?: string;
  endedAt?: string | null;
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function getDaemonBaseUrl(): string {
  return `http://127.0.0.1:${getActualListenPort()}`;
}

async function fetchDaemon<T>(path: string): Promise<T> {
  const response = await fetch(`${getDaemonBaseUrl()}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function isConnectError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("fetch failed") ||
      error.message.includes("ENOTFOUND")
    );
  }
  return false;
}

// Tool definitions for MCP tools/list
const toolDefinitions = [
  {
    name: "check_health",
    description: "Check if the Agent Recorder daemon is running and healthy",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_sessions",
    description: "List recent recording sessions",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of sessions to return (default: 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_session_summary",
    description:
      "Get a structured summary of a specific session including tool usage and errors",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The session ID to summarize",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_errors",
    description: "Get error events from a specific session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The session ID to inspect",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_tool_call_stats",
    description: "Get per-tool call statistics for a specific session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The session ID to analyze",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_latest_session_summary",
    description: "Get a structured summary of the most recent session",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

async function toolCheckHealth(): Promise<string> {
  try {
    const health = await fetchDaemon<{
      status: string;
      pid: number;
      uptime: number;
      mode: string;
    }>("/api/health");
    return `Agent Recorder is running. Status: ${health.status}, PID: ${health.pid}, Uptime: ${Math.round(health.uptime)}s, Mode: ${health.mode}`;
  } catch (error) {
    if (isConnectError(error)) {
      return DAEMON_NOT_RUNNING_MSG;
    }
    return `Health check failed: ${String(error)}`;
  }
}

async function toolListSessions(limit = 10): Promise<string> {
  try {
    const sessions = await fetchDaemon<Session[]>("/api/sessions");
    const sliced = sessions.slice(0, limit);
    if (sliced.length === 0) {
      return "No sessions found.";
    }
    const rows = sliced.map((s) => ({
      id: s.id,
      status: s.status,
      created_at: s.startedAt,
      event_count: null,
    }));
    return JSON.stringify(rows, null, 2);
  } catch (error) {
    if (isConnectError(error)) {
      return DAEMON_NOT_RUNNING_MSG;
    }
    return `Failed to list sessions: ${String(error)}`;
  }
}

async function buildSessionSummary(sessionId: string): Promise<string> {
  const [session, events] = await Promise.all([
    fetchDaemon<Session>(`/api/sessions/${sessionId}`),
    fetchDaemon<BaseEvent[]>(`/api/sessions/${sessionId}/events`),
  ]);

  const toolCalls = events.filter(
    (e) => e.eventType === "tool_call" && e.toolName
  );
  const errorEvents = events.filter((e) => e.status === "error");
  const toolsUsed = [
    ...new Set(toolCalls.map((e) => e.toolName).filter(Boolean)),
  ];

  const summary = {
    session_id: session.id,
    status: session.status,
    started_at: session.startedAt,
    ended_at: session.endedAt ?? null,
    total_events: events.length,
    total_tool_calls: toolCalls.length,
    tools_used: toolsUsed,
    error_count: errorEvents.length,
    errors: errorEvents.slice(0, 5).map((e) => ({
      tool: e.toolName ?? e.skillName ?? "-",
      message: e.errorCategory ?? "unknown",
      timestamp: e.startedAt ?? "",
      event_type: e.eventType,
    })),
    health: errorEvents.length === 0 ? "Clean" : "Errors detected",
  };

  return JSON.stringify(summary, null, 2);
}

async function toolGetSessionSummary(sessionId: string): Promise<string> {
  try {
    return await buildSessionSummary(sessionId);
  } catch (error) {
    if (isConnectError(error)) {
      return DAEMON_NOT_RUNNING_MSG;
    }
    return `Failed to get session summary: ${String(error)}`;
  }
}

async function toolGetErrors(sessionId: string): Promise<string> {
  try {
    const events = await fetchDaemon<BaseEvent[]>(
      `/api/sessions/${sessionId}/events`
    );
    const errors = events
      .filter((e) => e.status === "error")
      .map((e) => ({
        tool: e.toolName ?? e.skillName ?? "-",
        message: e.errorCategory ?? "unknown",
        timestamp: e.startedAt ?? "",
        event_type: e.eventType,
      }));
    if (errors.length === 0) {
      return "No errors found in this session.";
    }
    return JSON.stringify(errors, null, 2);
  } catch (error) {
    if (isConnectError(error)) {
      return DAEMON_NOT_RUNNING_MSG;
    }
    return `Failed to get errors: ${String(error)}`;
  }
}

async function toolGetToolCallStats(sessionId: string): Promise<string> {
  try {
    const events = await fetchDaemon<BaseEvent[]>(
      `/api/sessions/${sessionId}/events`
    );
    const toolCalls = events.filter(
      (e) => e.eventType === "tool_call" && e.toolName
    );

    const statsMap = new Map<string, { calls: number; errors: number }>();
    for (const event of toolCalls) {
      const tool = event.toolName!;
      const existing = statsMap.get(tool) ?? { calls: 0, errors: 0 };
      existing.calls++;
      if (event.status === "error") {
        existing.errors++;
      }
      statsMap.set(tool, existing);
    }

    const stats = Array.from(statsMap.entries()).map(([tool, s]) => ({
      tool,
      calls: s.calls,
      errors: s.errors,
      success_rate:
        s.calls > 0
          ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(1)}%`
          : "N/A",
    }));

    if (stats.length === 0) {
      return "No tool calls found in this session.";
    }
    return JSON.stringify(stats, null, 2);
  } catch (error) {
    if (isConnectError(error)) {
      return DAEMON_NOT_RUNNING_MSG;
    }
    return `Failed to get tool call stats: ${String(error)}`;
  }
}

async function toolGetLatestSessionSummary(): Promise<string> {
  try {
    const sessions = await fetchDaemon<Session[]>("/api/sessions");
    if (sessions.length === 0) {
      return "No sessions found.";
    }
    const sorted = [...sessions].sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    return await buildSessionSummary(sorted[0]!.id);
  } catch (error) {
    if (isConnectError(error)) {
      return DAEMON_NOT_RUNNING_MSG;
    }
    return `Failed to get latest session: ${String(error)}`;
  }
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "check_health":
      return toolCheckHealth();
    case "list_sessions":
      return toolListSessions((args["limit"] as number | undefined) ?? 10);
    case "get_session_summary":
      return toolGetSessionSummary(args["session_id"] as string);
    case "get_errors":
      return toolGetErrors(args["session_id"] as string);
    case "get_tool_call_stats":
      return toolGetToolCallStats(args["session_id"] as string);
    case "get_latest_session_summary":
      return toolGetLatestSessionSummary();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRpcRequest(
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "agent-recorder-mcp",
            version: "1.0.0",
          },
        },
      };

    case "notifications/initialized":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: toolDefinitions },
      };

    case "tools/call": {
      const toolName = params?.["name"] as string | undefined;
      const toolArgs =
        (params?.["arguments"] as Record<string, unknown> | undefined) ?? {};

      if (!toolName) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing tool name" },
        };
      }

      if (!toolDefinitions.find((t) => t.name === toolName)) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        };
      }

      try {
        const text = await dispatchTool(toolName, toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
          },
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${String(error)}` }],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

function startMcpServer(host: string, port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          })
        );
        return;
      }

      if (request.jsonrpc !== "2.0" || !request.method) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: -32600, message: "Invalid Request" },
          })
        );
        return;
      }

      handleRpcRequest(request)
        .then((response) => {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify(response));
        })
        .catch((error) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id ?? null,
              error: { code: -32603, message: String(error) },
            })
          );
        });
    });
  });

  server.on("error", (err: Error & { code?: string }) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the existing instance or use --port to choose another.`
      );
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(
      `Agent Recorder MCP server listening on http://${host}:${port}/`
    );
    console.log("");
    console.log("Available tools:");
    for (const tool of toolDefinitions) {
      console.log(`  - ${tool.name}`);
    }
    console.log("");
    console.log("Connect MCP clients to this URL.");
    console.log("Press Ctrl+C to stop.");
  });

  return server;
}

export interface McpServerOptions {
  port?: string;
  host?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "::1", "0:0:0:0:0:0:0:1"]);

/** Heuristic, not exhaustive: literal 127.0.0.0/8 (optionally IPv4-mapped). */
function isLoopback(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  const literal = host.startsWith("::ffff:") ? host.slice(7) : host;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(literal);
}

/** Resolve the bind host, defaulting to loopback; warn on wider binds. */
export function resolveBindHost(rawHost: string | undefined): {
  host: string;
  warning?: string;
} {
  const host = rawHost ?? "127.0.0.1";
  if (isLoopback(host)) {
    return { host };
  }
  return {
    host,
    warning:
      `Warning: binding to ${host} exposes this server beyond localhost. ` +
      `It has no authentication - anyone who can reach it can read recorded sessions.`,
  };
}

export async function mcpServerCommand(
  options: McpServerOptions = {}
): Promise<void> {
  const port = parseInt(options.port ?? "8789", 10);
  const { host, warning } = resolveBindHost(options.host);

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${options.port}`);
    process.exit(1);
  }

  if (warning) {
    console.warn(warning);
  }

  const server = startMcpServer(host, port);

  process.on("SIGINT", () => {
    console.log("\nShutting down MCP server...");
    server.close(() => {
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
