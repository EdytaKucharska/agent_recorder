/**
 * Claude Code configuration detection and management.
 * Supports both v2 (~/.claude/settings.json) and legacy (~/.config/claude/mcp.json) paths.
 */
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
export declare function getV2ConfigPath(): string;
/**
 * Get the legacy Claude config path (~/.config/claude/mcp.json)
 */
export declare function getLegacyConfigPath(): string;
/**
 * Detect which Claude config file exists.
 * Checks v2 first, then legacy. Returns 'none' if neither exists.
 */
export declare function detectClaudeConfig(): ClaudeConfigInfo;
/**
 * Safely read and parse a JSON file.
 * Returns null if file doesn't exist or is invalid JSON.
 */
export declare function readJsonFile(
  filePath: string
): Record<string, unknown> | null;
/**
 * Write JSON to file atomically (write to temp, then rename).
 * Creates parent directories if needed.
 */
export declare function writeJsonFileAtomic(
  filePath: string,
  data: Record<string, unknown>
): void;
/**
 * Create a backup of a file with timestamp.
 * Returns the backup path.
 */
export declare function createBackup(filePath: string): string;
/**
 * Get the agent-recorder MCP server entry from a config object.
 */
export declare function getMcpServerEntry(
  config: Record<string, unknown>
): McpServerEntry | null;
/**
 * Set the agent-recorder MCP server entry in a config object.
 * Returns a new config object (does not mutate input).
 */
export declare function setMcpServerEntry(
  config: Record<string, unknown>,
  url: string
): Record<string, unknown>;
/**
 * Format a path for display, replacing home directory with ~
 */
export declare function formatPath(filePath: string): string;
//# sourceMappingURL=claude-paths.d.ts.map
