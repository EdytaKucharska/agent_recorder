/**
 * Claude Code configuration detection and management.
 * Supports both v2 (~/.claude/settings.json) and legacy (~/.config/claude/mcp.json) paths.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface ClaudeConfigInfo {
  kind: "v2" | "legacy" | "none";
  path: string | null;
}

export interface McpServerEntry {
  url?: string;
  command?: string;
  args?: string[];
}

/**
 * Get the v2 Claude config path (~/.claude/settings.json)
 */
export function getV2ConfigPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

/**
 * Get the legacy Claude config path (~/.config/claude/mcp.json)
 */
export function getLegacyConfigPath(): string {
  return path.join(os.homedir(), ".config", "claude", "mcp.json");
}

/**
 * Detect which Claude config file exists.
 * Checks v2 first, then legacy. Returns 'none' if neither exists.
 */
export function detectClaudeConfig(): ClaudeConfigInfo {
  const v2Path = getV2ConfigPath();
  const legacyPath = getLegacyConfigPath();

  if (fs.existsSync(v2Path)) {
    return { kind: "v2", path: v2Path };
  }

  if (fs.existsSync(legacyPath)) {
    return { kind: "legacy", path: legacyPath };
  }

  return { kind: "none", path: null };
}

/**
 * Safely read and parse a JSON file.
 * Returns null if file doesn't exist or is invalid JSON.
 */
export function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Write JSON to file atomically (write to temp, then rename).
 * Creates parent directories if needed.
 */
export function writeJsonFileAtomic(
  filePath: string,
  data: Record<string, unknown>
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(data, null, 2) + "\n";
  const tempPath = `${filePath}.tmp.${Date.now()}`;

  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, filePath);
}

/**
 * Create a backup of a file with timestamp.
 * Returns the backup path.
 */
export function createBackup(filePath: string): string {
  const now = new Date();
  // Format: YYYYMMDDHHMMSS (14 chars)
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupPath = `${filePath}.bak-${timestamp}`;

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
  }

  return backupPath;
}

/**
 * Get the agent-recorder MCP server entry from a config object.
 */
export function getMcpServerEntry(
  config: Record<string, unknown>
): McpServerEntry | null {
  const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== "object") {
    return null;
  }

  const entry = mcpServers["agent-recorder"] as McpServerEntry | undefined;
  if (!entry || typeof entry !== "object") {
    return null;
  }

  return entry;
}

/**
 * Set the agent-recorder MCP server entry in a config object.
 * Returns a new config object (does not mutate input).
 */
export function setMcpServerEntry(
  config: Record<string, unknown>,
  url: string
): Record<string, unknown> {
  const newConfig = { ...config };

  // Ensure mcpServers exists
  const mcpServers = (newConfig.mcpServers as Record<string, unknown>) || {};
  newConfig.mcpServers = {
    ...mcpServers,
    "agent-recorder": { url },
  };

  return newConfig;
}

/**
 * Format a path for display, replacing home directory with ~
 */
export function formatPath(filePath: string): string {
  const home = os.homedir();
  if (filePath.startsWith(home)) {
    return "~" + filePath.slice(home.length);
  }
  return filePath;
}
