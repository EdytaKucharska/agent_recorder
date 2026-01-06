/**
 * Types for the STDIO proxy
 */

/** JSON-RPC 2.0 request structure */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id?: string | number | null;
}

/** JSON-RPC 2.0 response structure */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

/** Recorded MCP message for telemetry */
export interface McpMessage {
  /** Timestamp when message was captured */
  timestamp: string;
  /** Direction: client → server or server → client */
  direction: "request" | "response";
  /** Raw JSON-RPC message */
  raw: string;
  /** Parsed method (if request) */
  method?: string | undefined;
  /** Parsed id (for correlation) */
  id?: string | number | null | undefined;
  /** Whether this is an error response */
  isError?: boolean | undefined;
}

/** Proxy configuration options */
export interface ProxyOptions {
  /** Command to execute (e.g., "npx") */
  command: string;
  /** Arguments for the command */
  args: string[];
  /** Working directory */
  cwd?: string | undefined;
  /** Environment variables to pass */
  env?: Record<string, string> | undefined;
  /** Output file for JSONL logs */
  outputFile?: string | undefined;
  /** Remote endpoint to POST telemetry */
  endpoint?: string | undefined;
  /** Enable debug logging to stderr */
  debug?: boolean | undefined;
  /** Session ID for correlation */
  sessionId?: string | undefined;
}

/** Proxy state */
export interface ProxyState {
  /** Child process PID */
  childPid?: number | undefined;
  /** Whether proxy is running */
  running: boolean;
  /** Start timestamp */
  startedAt?: string | undefined;
  /** Message counts */
  requestCount: number;
  responseCount: number;
}
