/**
 * Configure commands - manage Claude Code integration.
 */

import { loadConfig } from "@agent-recorder/core";
import {
  detectClaudeConfig,
  getV2ConfigPath,
  getLegacyConfigPath,
  readJsonFile,
  writeJsonFileAtomic,
  createBackup,
  getMcpServerEntry,
  setMcpServerEntry,
  formatPath,
} from "../config/claude-paths.js";

export interface ConfigureClaudeOptions {
  path?: string;
  legacy?: boolean;
  dryRun?: boolean;
}

/**
 * Configure Claude Code to use Agent Recorder.
 */
export async function configureClaudeCommand(
  options: ConfigureClaudeOptions = {}
): Promise<void> {
  const config = loadConfig();
  const expectedUrl = `http://127.0.0.1:${config.mcpProxyPort}/`;

  // Determine which config file to use
  let configPath: string;
  let configKind: "v2" | "legacy";

  if (options.path) {
    configPath = options.path;
    configKind = "v2"; // Assume v2 format for custom paths
  } else if (options.legacy) {
    configPath = getLegacyConfigPath();
    configKind = "legacy";
  } else {
    // Auto-detect or default to v2
    const detected = detectClaudeConfig();
    if (detected.kind !== "none" && detected.path) {
      configPath = detected.path;
      configKind = detected.kind;
    } else {
      // Default to v2 if no config exists
      configPath = getV2ConfigPath();
      configKind = "v2";
    }
  }

  // Read existing config or start fresh
  let existingConfig = readJsonFile(configPath);
  const isNewFile = existingConfig === null;
  if (existingConfig === null) {
    existingConfig = {};
  }

  // Check current state
  const currentEntry = getMcpServerEntry(existingConfig);
  const currentUrl = currentEntry?.url;

  // Create new config with updated URL
  const newConfig = setMcpServerEntry(existingConfig, expectedUrl);

  // Determine what changed
  const urlChanged = currentUrl !== expectedUrl;

  if (options.dryRun) {
    console.log("Dry run - no changes will be made\n");
    console.log(`Config file: ${formatPath(configPath)} (${configKind})`);
    console.log(`File exists: ${!isNewFile}`);
    console.log("");

    if (isNewFile) {
      console.log("Would create new file with:");
    } else if (urlChanged) {
      console.log("Would update:");
      if (currentUrl) {
        console.log(`  - mcpServers.agent-recorder.url: ${currentUrl}`);
      }
      console.log(`  + mcpServers.agent-recorder.url: ${expectedUrl}`);
    } else {
      console.log("No changes needed - URL already correct.");
    }
    return;
  }

  // Create backup if file exists
  let backupPath: string | null = null;
  if (!isNewFile) {
    backupPath = createBackup(configPath);
  }

  // Write the config
  writeJsonFileAtomic(configPath, newConfig);

  // Report results
  if (isNewFile) {
    console.log(`Created: ${formatPath(configPath)} (${configKind})`);
  } else {
    console.log(`Found: ${formatPath(configPath)} (${configKind})`);
    console.log(`Backup: ${formatPath(backupPath!)}`);
  }

  console.log(`Set: mcpServers.agent-recorder.url = ${expectedUrl}`);
  console.log("");
  console.log("Restart Claude Code to apply changes.");
}

/**
 * Show current Claude Code configuration status.
 */
export async function configureShowCommand(): Promise<void> {
  const config = loadConfig();
  const expectedUrl = `http://127.0.0.1:${config.mcpProxyPort}/`;

  console.log("Claude Code Configuration");
  console.log("=========================");
  console.log("");

  // Detect config
  const detected = detectClaudeConfig();

  if (detected.kind === "none") {
    console.log("Config file:    not found");
    console.log("Checked:");
    console.log(`  - ${formatPath(getV2ConfigPath())} (v2)`);
    console.log(`  - ${formatPath(getLegacyConfigPath())} (legacy)`);
    console.log("");
    console.log("Run 'agent-recorder configure claude' to create config.");
    return;
  }

  console.log(
    `Config file:    ${formatPath(detected.path!)} (${detected.kind})`
  );

  // Read and check config
  const configData = readJsonFile(detected.path!);
  if (configData === null) {
    console.log("Status:         error reading file");
    return;
  }

  const entry = getMcpServerEntry(configData);
  if (entry === null) {
    console.log("MCP entry:      not present");
    console.log("");
    console.log("Run 'agent-recorder configure claude' to add entry.");
    return;
  }

  console.log("MCP entry:      present");

  if (entry.url) {
    const matches = entry.url === expectedUrl;
    const symbol = matches ? "\u2713" : "\u2717";
    console.log(`URL:            ${entry.url}`);
    if (matches) {
      console.log(
        `                (${symbol} matches expected port ${config.mcpProxyPort})`
      );
    } else {
      console.log(`                (${symbol} expected ${expectedUrl})`);
      console.log("");
      console.log("Run 'agent-recorder configure claude' to fix URL.");
    }
  } else if (entry.command) {
    console.log(`Command:        ${entry.command}`);
    if (entry.args) {
      console.log(`Args:           ${entry.args.join(" ")}`);
    }
    console.log("                (stdio mode - not managed by agent-recorder)");
  }
}
