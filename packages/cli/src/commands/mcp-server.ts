/**
 * MCP Server command - exposes Agent Recorder observability tools via MCP protocol.
 *
 * Transports:
 *   - Streamable HTTP: POST /          (local / Claude Code use)
 *   - SSE:             GET /sse + POST /message  (n8n and cloud clients)
 *
 * Storage modes (selected automatically):
 *   - Cloud mode: SUPABASE_URL + SUPABASE_KEY env vars set → writes to Supabase PostgreSQL
 *   - Local mode: reads from local Agent Recorder daemon REST API (default)
 *
 * SSE note: if n8n cannot connect, check that /sse responds with
 * Content-Type: text/event-stream and Connection: keep-alive.
 */

import * as http from "node:http";
import * as crypto from "node:crypto";
import { getActualListenPort } from "@agent-recorder/core";

const DAEMON_NOT_RUNNING_MSG =
  "Agent Recorder daemon not running. Start with: agent-recorder start";

// ── Types ────────────────────────────────────────────────────────────────────

interface LocalSession {
  id: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
}

interface LocalEvent {
  sequence: number;
  eventType: string;
  status: string;
  toolName?: string | null;
  skillName?: string | null;
  errorCategory?: string | null;
  startedAt?: string;
  endedAt?: string | null;
}

interface SupabaseSession {
  id: string;
  description: string | null;
  status: string;
  event_count: number;
  created_at: string;
  ended_at: string | null;
}

interface SupabaseEvent {
  id: string;
  session_id: string;
  tool_name: string;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
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

interface SseConnection {
  res: http.ServerResponse;
  pingTimer: ReturnType<typeof setInterval>;
  timeout: ReturnType<typeof setTimeout>;
}

// ── Mode helpers ─────────────────────────────────────────────────────────────

function isCloudMode(): boolean {
  return !!(process.env["SUPABASE_URL"] && process.env["SUPABASE_KEY"]);
}

// ── Supabase storage layer ───────────────────────────────────────────────────

async function supabaseFetch<T>(
  path: string,
  method: string = "GET",
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const url = `${process.env["SUPABASE_URL"]}${path}`;
  const key = process.env["SUPABASE_KEY"]!;
  const init: Parameters<typeof fetch>[1] = {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extraHeaders,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${method} ${path}: ${response.status} ${text}`);
  }
  const contentLength = response.headers.get("content-length");
  if (response.status === 204 || contentLength === "0") {
    return [] as unknown as T;
  }
  return response.json() as Promise<T>;
}

async function supabaseGetSession(
  sessionId: string
): Promise<SupabaseSession | null> {
  const rows = await supabaseFetch<SupabaseSession[]>(
    `/rest/v1/sessions?id=eq.${sessionId}`
  );
  return rows[0] ?? null;
}

async function supabaseGetEvents(sessionId: string): Promise<SupabaseEvent[]> {
  return supabaseFetch<SupabaseEvent[]>(
    `/rest/v1/events?session_id=eq.${sessionId}&order=created_at.asc`
  );
}

// ── Local daemon helpers ─────────────────────────────────────────────────────

function getDaemonBaseUrl(): string {
  return `http://127.0.0.1:${getActualListenPort()}`;
}

async function fetchDaemon<T>(path: string): Promise<T> {
  const response = await fetch(`${getDaemonBaseUrl()}${path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

// ── Tool definitions ─────────────────────────────────────────────────────────

const toolDefinitions = [
  {
    name: "start_session",
    description:
      "Start a new Agent Recorder session. Call this at the beginning of your workflow. Returns a session_id to use in subsequent log_event and end_session calls.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Optional description of what this workflow does",
        },
      },
      required: [],
    },
  },
  {
    name: "log_event",
    description:
      "Log a tool call event. Call this after every tool use in your workflow to record what happened.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID returned by start_session",
        },
        tool_name: {
          type: "string",
          description:
            "Name of the tool that was called (e.g. supabase_query, send_email, linear_create_issue)",
        },
        status: {
          type: "string",
          description: "Result: success | error | running",
        },
        duration_ms: {
          type: "number",
          description: "How long the tool call took in milliseconds",
        },
        error_message: {
          type: "string",
          description: "Error message if status is error",
        },
      },
      required: ["session_id", "tool_name", "status"],
    },
  },
  {
    name: "end_session",
    description:
      "End the session and get a final summary with error count and tool stats. Call this at the end of your workflow.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID returned by start_session",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "check_health",
    description: "Check if Agent Recorder is reachable and healthy",
    inputSchema: { type: "object", properties: {}, required: [] },
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
      "Get a structured summary of a specific session including tool usage and error rate",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to summarize" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_errors",
    description: "Get all error events from a session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to inspect" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_tool_call_stats",
    description:
      "Get per-tool call statistics (calls, errors, success_rate) for a session",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to analyze" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_latest_session_summary",
    description: "Get a structured summary of the most recent session",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ── Tool implementations ─────────────────────────────────────────────────────

async function toolStartSession(description?: string): Promise<string> {
  if (!isCloudMode()) {
    return "start_session requires cloud mode. Set SUPABASE_URL and SUPABASE_KEY environment variables.";
  }
  try {
    const rows = await supabaseFetch<SupabaseSession[]>(
      "/rest/v1/sessions",
      "POST",
      {
        description: description ?? null,
        status: "active",
      }
    );
    const session = rows[0]!;
    return JSON.stringify({
      session_id: session.id,
      status: session.status,
      created_at: session.created_at,
    });
  } catch (error) {
    return `Failed to start session: ${String(error)}`;
  }
}

async function toolLogEvent(
  sessionId: string,
  toolName: string,
  status: string,
  durationMs?: number,
  errorMessage?: string
): Promise<string> {
  if (!isCloudMode()) {
    return "log_event requires cloud mode. Set SUPABASE_URL and SUPABASE_KEY environment variables.";
  }
  try {
    await supabaseFetch<SupabaseEvent[]>("/rest/v1/events", "POST", {
      session_id: sessionId,
      tool_name: toolName,
      status,
      duration_ms: durationMs ?? null,
      error_message: errorMessage ?? null,
    });
    return `Logged: ${toolName} → ${status}${durationMs !== undefined ? ` (${durationMs}ms)` : ""}`;
  } catch (error) {
    return `Failed to log event: ${String(error)}`;
  }
}

async function toolEndSession(sessionId: string): Promise<string> {
  if (!isCloudMode()) {
    return "end_session requires cloud mode. Set SUPABASE_URL and SUPABASE_KEY environment variables.";
  }
  try {
    const [session, events] = await Promise.all([
      supabaseGetSession(sessionId),
      supabaseGetEvents(sessionId),
    ]);
    if (!session) return `Session not found: ${sessionId}`;

    await supabaseFetch(`/rest/v1/sessions?id=eq.${sessionId}`, "PATCH", {
      status: "completed",
      ended_at: new Date().toISOString(),
      event_count: events.length,
    });

    const errors = events.filter((e) => e.status === "error");
    const toolStats = new Map<string, { calls: number; errors: number }>();
    for (const e of events) {
      const s = toolStats.get(e.tool_name) ?? { calls: 0, errors: 0 };
      s.calls++;
      if (e.status === "error") s.errors++;
      toolStats.set(e.tool_name, s);
    }

    return JSON.stringify(
      {
        session_id: sessionId,
        status: "completed",
        total_events: events.length,
        error_count: errors.length,
        health: errors.length === 0 ? "Clean" : "Errors detected",
        tool_stats: Object.fromEntries(
          Array.from(toolStats.entries()).map(([tool, s]) => [
            tool,
            { calls: s.calls, errors: s.errors },
          ])
        ),
      },
      null,
      2
    );
  } catch (error) {
    return `Failed to end session: ${String(error)}`;
  }
}

async function toolCheckHealth(): Promise<string> {
  if (isCloudMode()) {
    try {
      await supabaseFetch<unknown>("/rest/v1/sessions?limit=1");
      return "Agent Recorder cloud mode: Supabase connection healthy.";
    } catch (error) {
      return `Supabase connection error: ${String(error)}`;
    }
  }
  try {
    const health = await fetchDaemon<{
      status: string;
      pid: number;
      uptime: number;
      mode: string;
    }>("/api/health");
    return `Agent Recorder is running. Status: ${health.status}, PID: ${health.pid}, Uptime: ${Math.round(health.uptime)}s, Mode: ${health.mode}`;
  } catch (error) {
    if (isConnectError(error)) return DAEMON_NOT_RUNNING_MSG;
    return `Health check failed: ${String(error)}`;
  }
}

async function toolListSessions(limit = 10): Promise<string> {
  if (isCloudMode()) {
    try {
      const sessions = await supabaseFetch<SupabaseSession[]>(
        `/rest/v1/sessions?order=created_at.desc&limit=${limit}`
      );
      if (sessions.length === 0) return "No sessions found.";
      return JSON.stringify(
        sessions.map((s) => ({
          id: s.id,
          description: s.description,
          status: s.status,
          event_count: s.event_count,
          created_at: s.created_at,
        })),
        null,
        2
      );
    } catch (error) {
      return `Failed to list sessions: ${String(error)}`;
    }
  }
  try {
    const sessions = await fetchDaemon<LocalSession[]>("/api/sessions");
    const sliced = sessions.slice(0, limit);
    if (sliced.length === 0) return "No sessions found.";
    return JSON.stringify(
      sliced.map((s) => ({
        id: s.id,
        status: s.status,
        created_at: s.startedAt,
      })),
      null,
      2
    );
  } catch (error) {
    if (isConnectError(error)) return DAEMON_NOT_RUNNING_MSG;
    return `Failed to list sessions: ${String(error)}`;
  }
}

async function buildSupabaseSummary(sessionId: string): Promise<string> {
  const [session, events] = await Promise.all([
    supabaseGetSession(sessionId),
    supabaseGetEvents(sessionId),
  ]);
  if (!session) return `Session not found: ${sessionId}`;
  const errors = events.filter((e) => e.status === "error");
  const toolsUsed = [...new Set(events.map((e) => e.tool_name))];
  return JSON.stringify(
    {
      session_id: session.id,
      description: session.description,
      status: session.status,
      started_at: session.created_at,
      ended_at: session.ended_at,
      total_events: events.length,
      tools_used: toolsUsed,
      error_count: errors.length,
      errors: errors.slice(0, 5).map((e) => ({
        tool: e.tool_name,
        message: e.error_message ?? "unknown",
        timestamp: e.created_at,
      })),
      health: errors.length === 0 ? "Clean" : "Errors detected",
    },
    null,
    2
  );
}

async function buildLocalSummary(sessionId: string): Promise<string> {
  const [session, events] = await Promise.all([
    fetchDaemon<LocalSession>(`/api/sessions/${sessionId}`),
    fetchDaemon<LocalEvent[]>(`/api/sessions/${sessionId}/events`),
  ]);
  const toolCalls = events.filter(
    (e) => e.eventType === "tool_call" && e.toolName
  );
  const errorEvents = events.filter((e) => e.status === "error");
  const toolsUsed = [
    ...new Set(toolCalls.map((e) => e.toolName).filter(Boolean)),
  ];
  return JSON.stringify(
    {
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
    },
    null,
    2
  );
}

async function toolGetSessionSummary(sessionId: string): Promise<string> {
  try {
    return isCloudMode()
      ? await buildSupabaseSummary(sessionId)
      : await buildLocalSummary(sessionId);
  } catch (error) {
    if (isConnectError(error)) return DAEMON_NOT_RUNNING_MSG;
    return `Failed to get session summary: ${String(error)}`;
  }
}

async function toolGetErrors(sessionId: string): Promise<string> {
  if (isCloudMode()) {
    try {
      const events = await supabaseFetch<SupabaseEvent[]>(
        `/rest/v1/events?session_id=eq.${sessionId}&status=eq.error&order=created_at.asc`
      );
      if (events.length === 0) return "No errors found in this session.";
      return JSON.stringify(
        events.map((e) => ({
          tool: e.tool_name,
          message: e.error_message ?? "unknown",
          timestamp: e.created_at,
        })),
        null,
        2
      );
    } catch (error) {
      return `Failed to get errors: ${String(error)}`;
    }
  }
  try {
    const events = await fetchDaemon<LocalEvent[]>(
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
    if (errors.length === 0) return "No errors found in this session.";
    return JSON.stringify(errors, null, 2);
  } catch (error) {
    if (isConnectError(error)) return DAEMON_NOT_RUNNING_MSG;
    return `Failed to get errors: ${String(error)}`;
  }
}

async function toolGetToolCallStats(sessionId: string): Promise<string> {
  if (isCloudMode()) {
    try {
      const events = await supabaseGetEvents(sessionId);
      const statsMap = new Map<string, { calls: number; errors: number }>();
      for (const e of events) {
        const s = statsMap.get(e.tool_name) ?? { calls: 0, errors: 0 };
        s.calls++;
        if (e.status === "error") s.errors++;
        statsMap.set(e.tool_name, s);
      }
      if (statsMap.size === 0) return "No tool calls found in this session.";
      return JSON.stringify(
        Array.from(statsMap.entries()).map(([tool, s]) => ({
          tool,
          calls: s.calls,
          errors: s.errors,
          success_rate:
            s.calls > 0
              ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(1)}%`
              : "N/A",
        })),
        null,
        2
      );
    } catch (error) {
      return `Failed to get tool call stats: ${String(error)}`;
    }
  }
  try {
    const events = await fetchDaemon<LocalEvent[]>(
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
      if (event.status === "error") existing.errors++;
      statsMap.set(tool, existing);
    }
    if (statsMap.size === 0) return "No tool calls found in this session.";
    return JSON.stringify(
      Array.from(statsMap.entries()).map(([tool, s]) => ({
        tool,
        calls: s.calls,
        errors: s.errors,
        success_rate:
          s.calls > 0
            ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(1)}%`
            : "N/A",
      })),
      null,
      2
    );
  } catch (error) {
    if (isConnectError(error)) return DAEMON_NOT_RUNNING_MSG;
    return `Failed to get tool call stats: ${String(error)}`;
  }
}

async function toolGetLatestSessionSummary(): Promise<string> {
  if (isCloudMode()) {
    try {
      const sessions = await supabaseFetch<SupabaseSession[]>(
        "/rest/v1/sessions?order=created_at.desc&limit=1"
      );
      if (sessions.length === 0) return "No sessions found.";
      return await buildSupabaseSummary(sessions[0]!.id);
    } catch (error) {
      return `Failed to get latest session: ${String(error)}`;
    }
  }
  try {
    const sessions = await fetchDaemon<LocalSession[]>("/api/sessions");
    if (sessions.length === 0) return "No sessions found.";
    const sorted = [...sessions].sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    return await buildLocalSummary(sorted[0]!.id);
  } catch (error) {
    if (isConnectError(error)) return DAEMON_NOT_RUNNING_MSG;
    return `Failed to get latest session: ${String(error)}`;
  }
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "start_session":
      return toolStartSession(args["description"] as string | undefined);
    case "log_event":
      return toolLogEvent(
        args["session_id"] as string,
        args["tool_name"] as string,
        args["status"] as string,
        args["duration_ms"] as number | undefined,
        args["error_message"] as string | undefined
      );
    case "end_session":
      return toolEndSession(args["session_id"] as string);
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

// ── MCP JSON-RPC handler ─────────────────────────────────────────────────────

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
          serverInfo: { name: "agent-recorder-mcp", version: "1.0.0" },
        },
      };

    case "notifications/initialized":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: toolDefinitions } };

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
          result: { content: [{ type: "text", text }] },
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

// ── SSE transport ────────────────────────────────────────────────────────────

const sseConnections = new Map<string, SseConnection>();

function handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
  const sessionId = crypto.randomUUID();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Tell the client where to POST messages
  res.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`);

  // Keep-alive pings every 15 s
  const pingTimer = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);

  // Auto-close after 30 minutes
  const timeout = setTimeout(
    () => {
      clearInterval(pingTimer);
      sseConnections.delete(sessionId);
      res.end();
    },
    30 * 60 * 1_000
  );

  sseConnections.set(sessionId, { res, pingTimer, timeout });

  req.on("close", () => {
    clearInterval(pingTimer);
    clearTimeout(timeout);
    sseConnections.delete(sessionId);
  });
}

function handleSseMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): void {
  const conn = sseConnections.get(sessionId);
  if (!conn) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "SSE session not found" }));
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
      res.writeHead(400);
      res.end();
      conn.res.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n\n`
      );
      return;
    }

    // Acknowledge the POST immediately; response arrives via SSE stream
    res.writeHead(202);
    res.end();

    handleRpcRequest(request)
      .then((response) => {
        conn.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      })
      .catch((error) => {
        conn.res.write(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32603, message: String(error) } })}\n\n`
        );
      });
  });
}

// ── HTTP server ──────────────────────────────────────────────────────────────

function startMcpServer(host: string, port: number): http.Server {
  const server = http.createServer((req, res) => {
    const urlObj = new URL(
      req.url ?? "/",
      `http://${req.headers["host"] ?? "localhost"}`
    );
    const pathname = urlObj.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // SSE: open stream
    if (req.method === "GET" && pathname === "/sse") {
      handleSse(req, res);
      return;
    }

    // SSE: receive message
    if (req.method === "POST" && pathname === "/message") {
      const sessionId = urlObj.searchParams.get("sessionId");
      if (!sessionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing sessionId query parameter" }));
        return;
      }
      handleSseMessage(req, res, sessionId);
      return;
    }

    // Streamable HTTP: POST /
    if (req.method === "POST") {
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
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
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
    const mode = isCloudMode() ? "cloud (Supabase)" : "local (daemon)";
    console.log(
      `Agent Recorder MCP server listening on http://${host}:${port}/`
    );
    console.log(`Storage mode: ${mode}`);
    console.log("");
    console.log("Transports:");
    console.log(`  Streamable HTTP : POST http://${host}:${port}/`);
    console.log(`  SSE             : GET  http://${host}:${port}/sse`);
    console.log("");
    console.log("Available tools:");
    for (const tool of toolDefinitions) {
      console.log(`  - ${tool.name}`);
    }
    console.log("");
    console.log("Press Ctrl+C to stop.");
  });

  return server;
}

export interface McpServerOptions {
  port?: string;
  host?: string;
}

export async function mcpServerCommand(
  options: McpServerOptions = {}
): Promise<void> {
  const port = parseInt(
    options.port ?? process.env["AR_MCP_PORT"] ?? "8789",
    10
  );
  const host = options.host ?? "0.0.0.0";

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${options.port}`);
    process.exit(1);
  }

  const server = startMcpServer(host, port);

  process.on("SIGINT", () => {
    console.log("\nShutting down MCP server...");
    server.close(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
}
