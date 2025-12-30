/**
 * Configuration management.
 * Reads from environment variables with sensible defaults.
 */

export interface Config {
  /** Port for the daemon to listen on (default: 8787) */
  listenPort: number;

  /** Path to SQLite database file (default: .storage/agent-recorder.sqlite) */
  dbPath: string;

  /** Keys to redact from JSON payloads */
  redactKeys: string[];

  /** Port for MCP proxy to listen on (default: 8788) */
  mcpProxyPort: number;

  /** URL of downstream MCP server to forward requests to (optional) */
  downstreamMcpUrl: string | null;
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
  const dbPath = process.env["AR_DB_PATH"] ?? ".storage/agent-recorder.sqlite";
  const redactKeysRaw = process.env["AR_REDACT_KEYS"];
  const redactKeys = redactKeysRaw
    ? redactKeysRaw.split(",").map((k) => k.trim())
    : DEFAULT_REDACT_KEYS;
  const mcpProxyPort = parseInt(process.env["AR_MCP_PROXY_PORT"] ?? "8788", 10);
  const downstreamMcpUrl = process.env["AR_DOWNSTREAM_MCP_URL"] ?? null;

  return {
    listenPort,
    dbPath,
    redactKeys,
    mcpProxyPort,
    downstreamMcpUrl,
  };
}
