/**
 * Claude Code configuration detection and management utilities.
 * Shared between CLI and service packages.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface ClaudeConfigInfo {
  kind: "v2" | "legacy" | "none";
  path: string | null;
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
  data: Record<string, unknown> | unknown
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
