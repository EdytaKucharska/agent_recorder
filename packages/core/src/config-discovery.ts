/**
 * Multi-source MCP configuration discovery.
 * Discovers MCP servers from Claude Code, Cursor, VS Code, and project-level configs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export type ConfigSourceType =
  | "claude-code-v2"
  | "claude-code-legacy"
  | "cursor"
  | "vscode-user"
  | "project-claude"
  | "project-cursor";

export interface McpServerConfig {
  /** Server key/name */
  key: string;
  /** URL for HTTP-based servers */
  url?: string;
  /** Command for stdio-based servers */
  command?: string;
  /** Args for stdio-based servers */
  args?: string[];
  /** Environment variables for stdio servers */
  env?: Record<string, string>;
  /** Headers for HTTP servers */
  headers?: Record<string, string>;
  /** Transport type (http, stdio, streamable-http) */
  transport?: string;
}

export interface ConfigSource {
  /** Source type identifier */
  type: ConfigSourceType;
  /** Human-readable name */
  name: string;
  /** Full path to config file */
  path: string;
  /** Whether the file exists */
  exists: boolean;
  /** MCP servers found in this config */
  servers: McpServerConfig[];
  /** Parse errors (if any) */
  error?: string;
}

export interface DiscoveryResult {
  /** All config sources checked */
  sources: ConfigSource[];
  /** Aggregate of all discovered servers with their source */
  allServers: Array<
    McpServerConfig & { source: ConfigSourceType; sourcePath: string }
  >;
  /** Servers that can be proxied (HTTP-based) */
  httpServers: Array<
    McpServerConfig & { source: ConfigSourceType; sourcePath: string }
  >;
  /** Servers that cannot be proxied yet (stdio-based) */
  stdioServers: Array<
    McpServerConfig & { source: ConfigSourceType; sourcePath: string }
  >;
  /** Remote servers (external URLs) */
  remoteServers: Array<
    McpServerConfig & { source: ConfigSourceType; sourcePath: string }
  >;
}

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get all known config file paths to check.
 */
export function getConfigPaths(
  projectDir?: string
): Array<{ type: ConfigSourceType; name: string; path: string }> {
  const home = os.homedir();
  const cwd = projectDir ?? process.cwd();

  const paths: Array<{ type: ConfigSourceType; name: string; path: string }> = [
    // Claude Code configs
    {
      type: "claude-code-v2",
      name: "Claude Code (global)",
      path: path.join(home, ".claude", "settings.json"),
    },
    {
      type: "claude-code-legacy",
      name: "Claude Code (legacy)",
      path: path.join(home, ".config", "claude", "mcp.json"),
    },
    // Cursor IDE config
    {
      type: "cursor",
      name: "Cursor IDE",
      path: path.join(home, ".cursor", "mcp.json"),
    },
    // VS Code user settings (platform-specific)
    {
      type: "vscode-user",
      name: "VS Code (user)",
      path: getVSCodeUserSettingsPath(),
    },
    // Project-level configs
    {
      type: "project-claude",
      name: "Project (.claude)",
      path: path.join(cwd, ".claude", "settings.json"),
    },
    {
      type: "project-cursor",
      name: "Project (.cursor)",
      path: path.join(cwd, ".cursor", "mcp.json"),
    },
  ];

  return paths;
}

/**
 * Get VS Code user settings path (platform-specific).
 */
function getVSCodeUserSettingsPath(): string {
  const home = os.homedir();
  const platform = os.platform();

  switch (platform) {
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Code",
        "User",
        "settings.json"
      );
    case "win32":
      return path.join(
        process.env.APPDATA ?? home,
        "Code",
        "User",
        "settings.json"
      );
    default: // linux and others
      return path.join(home, ".config", "Code", "User", "settings.json");
  }
}

// ============================================================================
// Server Classification
// ============================================================================

/**
 * Check if a URL is a remote (external) server.
 */
export function isRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    // Local hosts
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return false;
    }
    // Local network ranges
    if (
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      host.startsWith("172.")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine server type from config.
 */
export function getServerType(
  server: McpServerConfig
): "http" | "stdio" | "remote" {
  if (server.command) {
    return "stdio";
  }
  if (server.url) {
    return isRemoteUrl(server.url) ? "remote" : "http";
  }
  // Default to stdio if transport suggests it
  if (server.transport === "stdio") {
    return "stdio";
  }
  return "http";
}

// ============================================================================
// Config Parsing
// ============================================================================

/**
 * Parse MCP servers from a config object.
 * Handles both Claude Code and Cursor formats (they use the same schema).
 */
function parseMcpServers(
  configData: unknown,
  sourceType: ConfigSourceType
): McpServerConfig[] {
  if (
    !configData ||
    typeof configData !== "object" ||
    Array.isArray(configData)
  ) {
    return [];
  }

  const config = configData as Record<string, unknown>;
  let mcpServers: Record<string, unknown> | undefined;

  // VS Code nests MCP servers differently
  if (sourceType === "vscode-user") {
    // VS Code may have MCP config under various keys
    // Common patterns: "mcp.servers", "claude.mcpServers", etc.
    mcpServers =
      (config["mcp.servers"] as Record<string, unknown>) ??
      (config["claude.mcpServers"] as Record<string, unknown>) ??
      (config.mcpServers as Record<string, unknown>);
  } else {
    mcpServers = config.mcpServers as Record<string, unknown>;
  }

  if (
    !mcpServers ||
    typeof mcpServers !== "object" ||
    Array.isArray(mcpServers)
  ) {
    return [];
  }

  const servers: McpServerConfig[] = [];

  for (const [key, entry] of Object.entries(mcpServers)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const serverEntry = entry as Record<string, unknown>;

    // Build server config, only including defined properties
    const server: McpServerConfig = { key };

    if (typeof serverEntry.url === "string") {
      server.url = serverEntry.url;
    }
    if (typeof serverEntry.command === "string") {
      server.command = serverEntry.command;
    }
    if (Array.isArray(serverEntry.args)) {
      server.args = serverEntry.args as string[];
    }
    if (isPlainObject(serverEntry.env)) {
      server.env = serverEntry.env as Record<string, string>;
    }
    if (isPlainObject(serverEntry.headers)) {
      server.headers = serverEntry.headers as Record<string, string>;
    }
    if (typeof serverEntry.transport === "string") {
      server.transport = serverEntry.transport;
    }

    servers.push(server);
  }

  return servers;
}

function isPlainObject(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read and parse a config file.
 */
function readConfigFile(filePath: string): { data: unknown; error?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      return { data: null };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    return { data };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Unknown parse error",
    };
  }
}

// ============================================================================
// Main Discovery Function
// ============================================================================

/**
 * Discover all MCP server configurations from known sources.
 *
 * @param projectDir - Optional project directory for project-level configs (defaults to cwd)
 * @returns Discovery result with all found servers categorized by type
 */
export function discoverAllConfigs(projectDir?: string): DiscoveryResult {
  const configPaths = getConfigPaths(projectDir);
  const sources: ConfigSource[] = [];
  const allServers: DiscoveryResult["allServers"] = [];

  for (const { type, name, path: configPath } of configPaths) {
    const exists = fs.existsSync(configPath);
    const source: ConfigSource = {
      type,
      name,
      path: configPath,
      exists,
      servers: [],
    };

    if (exists) {
      const { data, error } = readConfigFile(configPath);
      if (error) {
        source.error = error;
      } else if (data) {
        source.servers = parseMcpServers(data, type);

        // Add to aggregate list
        for (const server of source.servers) {
          allServers.push({
            ...server,
            source: type,
            sourcePath: configPath,
          });
        }
      }
    }

    sources.push(source);
  }

  // Categorize servers
  const httpServers = allServers.filter((s) => getServerType(s) === "http");
  const stdioServers = allServers.filter((s) => getServerType(s) === "stdio");
  const remoteServers = allServers.filter((s) => getServerType(s) === "remote");

  return {
    sources,
    allServers,
    httpServers,
    stdioServers,
    remoteServers,
  };
}

/**
 * Get a summary of discovered configs for display.
 */
export function getDiscoverySummary(result: DiscoveryResult): string {
  const lines: string[] = [];

  lines.push("MCP Configuration Discovery");
  lines.push("===========================\n");

  // Sources
  lines.push("Config Sources:");
  for (const source of result.sources) {
    const status = source.exists
      ? source.error
        ? `⚠ error: ${source.error}`
        : `✓ ${source.servers.length} server(s)`
      : "- not found";
    lines.push(`  ${source.name.padEnd(22)} ${status}`);
    if (source.exists && !source.error) {
      lines.push(`    ${formatPathForDisplay(source.path)}`);
    }
  }
  lines.push("");

  // Server summary
  lines.push("Server Summary:");
  lines.push(`  Total discovered:    ${result.allServers.length}`);
  lines.push(`  HTTP (local):        ${result.httpServers.length} (can proxy)`);
  lines.push(
    `  HTTP (remote):       ${result.remoteServers.length} (can proxy)`
  );
  lines.push(
    `  Stdio:               ${result.stdioServers.length} (not yet supported)`
  );
  lines.push("");

  // Detailed server list
  if (result.allServers.length > 0) {
    lines.push("Discovered Servers:");
    for (const server of result.allServers) {
      const type = getServerType(server);
      const typeLabel =
        type === "remote" ? "remote" : type === "stdio" ? "stdio" : "http";
      const canProxy = type !== "stdio" ? "✓" : "✗";

      let endpoint = "";
      if (server.url) {
        endpoint = server.url;
      } else if (server.command) {
        endpoint = `${server.command} ${(server.args ?? []).join(" ")}`.trim();
      }

      lines.push(
        `  ${canProxy} ${server.key.padEnd(20)} [${typeLabel.padEnd(6)}] ${endpoint}`
      );
      lines.push(`    Source: ${getSourceLabel(server.source)}`);
    }
  }

  return lines.join("\n");
}

function formatPathForDisplay(filePath: string): string {
  const home = os.homedir();
  if (filePath.startsWith(home)) {
    return "~" + filePath.slice(home.length);
  }
  return filePath;
}

function getSourceLabel(source: ConfigSourceType): string {
  const labels: Record<ConfigSourceType, string> = {
    "claude-code-v2": "Claude Code (global)",
    "claude-code-legacy": "Claude Code (legacy)",
    cursor: "Cursor IDE",
    "vscode-user": "VS Code (user)",
    "project-claude": "Project (.claude)",
    "project-cursor": "Project (.cursor)",
  };
  return labels[source] ?? source;
}
