/**
 * Configuration management.
 * Reads from environment variables with sensible defaults.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Get the default database path in user's home directory */
export function getDefaultDbPath(): string {
  return join(homedir(), ".agent-recorder", "agent-recorder.sqlite");
}

/** Get the default upstreams registry path */
export function getDefaultUpstreamsPath(): string {
  return join(homedir(), ".agent-recorder", "upstreams.json");
}

export interface Config {
  /** Port for the daemon to listen on (default: 8787) */
  listenPort: number;

  /** Path to SQLite database file (default: ~/.agent-recorder/agent-recorder.sqlite) */
  dbPath: string;

  /** Keys to redact from JSON payloads */
  redactKeys: string[];

  /** Port for MCP proxy to listen on (default: 8788) */
  mcpProxyPort: number;

  /** URL of downstream MCP server to forward requests to (optional) */
  downstreamMcpUrl: string | null;

  /** Path to upstreams registry file for router mode (default: ~/.agent-recorder/upstreams.json) */
  upstreamsPath: string;

  /** Enable debug logging for MCP proxy (tools/call only) */
  debugProxy: boolean;
}

const DEFAULT_REDACT_KEYS = [
  "authorization",
  "Authorization",
  "api_key",
  "apikey",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
];

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): Config {
  const listenPort = parseInt(process.env["AR_LISTEN_PORT"] ?? "8787", 10);
  const dbPath = process.env["AR_DB_PATH"] ?? getDefaultDbPath();
  const redactKeysRaw = process.env["AR_REDACT_KEYS"];
  const redactKeys = redactKeysRaw
    ? redactKeysRaw.split(",").map((k) => k.trim())
    : DEFAULT_REDACT_KEYS;
  const mcpProxyPort = parseInt(process.env["AR_MCP_PROXY_PORT"] ?? "8788", 10);
  const downstreamMcpUrl = process.env["AR_DOWNSTREAM_MCP_URL"] ?? null;
  const upstreamsPath =
    process.env["AR_UPSTREAMS_PATH"] ?? getDefaultUpstreamsPath();
  const debugProxy = process.env["AR_DEBUG_PROXY"] === "1";

  return {
    listenPort,
    dbPath,
    redactKeys,
    mcpProxyPort,
    downstreamMcpUrl,
    upstreamsPath,
    debugProxy,
  };
}
