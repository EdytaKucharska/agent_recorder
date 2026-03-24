/**
 * Configuration management.
 * Reads from environment variables with sensible defaults.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readPortFile, checkDaemonStatus } from "./daemon-paths.js";

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

  /**
   * URL of the legacy single MCP server to proxy requests to (optional).
   * Note: In proxy terminology, these are "upstream" servers (the target).
   * The env var AR_DOWNSTREAM_MCP_URL is kept for backwards compatibility.
   * Prefer using the upstreams registry for multi-server setups.
   */
  downstreamMcpUrl: string | null;

  /** Path to upstreams registry file for router mode (default: ~/.agent-recorder/upstreams.json) */
  upstreamsPath: string;

  /** Enable debug logging for MCP proxy (tools/call only) */
  debugProxy: boolean;

  /** Context budget in tokens; warn when session exceeds this (default: 150000) */
  contextBudgetTokens: number;
}

/** Default context budget in tokens (~75% of Claude's 200k context window) */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 150000;

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
  // Support both old and new env var names (new takes precedence)
  const downstreamMcpUrl =
    process.env["AR_UPSTREAM_MCP_URL"] ??
    process.env["AR_DOWNSTREAM_MCP_URL"] ??
    null;
  const upstreamsPath =
    process.env["AR_UPSTREAMS_PATH"] ?? getDefaultUpstreamsPath();
  const debugProxy = process.env["AR_DEBUG_PROXY"] === "1";
  const _parsedBudget = parseInt(
    process.env["AR_CONTEXT_BUDGET_TOKENS"] ?? "",
    10
  );
  const contextBudgetTokens =
    Number.isFinite(_parsedBudget) && _parsedBudget > 0
      ? _parsedBudget
      : DEFAULT_CONTEXT_BUDGET_TOKENS;

  return {
    listenPort,
    dbPath,
    redactKeys,
    mcpProxyPort,
    downstreamMcpUrl,
    upstreamsPath,
    debugProxy,
    contextBudgetTokens,
  };
}

/**
 * Get the port the daemon is actually listening on.
 * Reads the runtime port file written by the daemon on startup,
 * falling back to AR_LISTEN_PORT / default if not present.
 *
 * Cross-validates with the PID file: if the daemon is not running,
 * treats the port file as stale and returns the configured port.
 */
export function getActualListenPort(): number {
  const defaultPort = parseInt(process.env["AR_LISTEN_PORT"] ?? "8787", 10);

  // If the daemon is not running, the port file is stale
  const { running } = checkDaemonStatus();
  if (!running) {
    return defaultPort;
  }

  // Daemon is running, read the port file
  return readPortFile() ?? defaultPort;
}
