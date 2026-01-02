/**
 * Configure commands - manage Claude Code integration.
 */

import {
  loadConfig,
  readProvidersFile,
  writeProvidersFile,
  getDefaultProvidersPath,
} from "@agent-recorder/core";
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
import { hubifyClaudeConfig, mergeProviders } from "../config/hubify.js";
import * as path from "node:path";
import * as fs from "node:fs";

export interface ConfigureClaudeOptions {
  path?: string;
  legacy?: boolean;
  dryRun?: boolean;
  hubify?: boolean;
  backupDir?: string;
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

  // Hubify mode: replace all MCP servers with agent-recorder hub
  if (options.hubify) {
    return await handleHubify(
      configPath,
      configKind,
      existingConfig,
      isNewFile,
      expectedUrl,
      options
    );
  }

  // Normal mode: just add/update agent-recorder entry
  return await handleNormalConfigure(
    configPath,
    configKind,
    existingConfig,
    isNewFile,
    expectedUrl,
    options
  );
}

/**
 * Handle normal (non-hubify) configure mode.
 */
async function handleNormalConfigure(
  configPath: string,
  configKind: "v2" | "legacy",
  existingConfig: Record<string, unknown>,
  isNewFile: boolean,
  expectedUrl: string,
  options: ConfigureClaudeOptions
): Promise<void> {
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
 * Handle hubify mode: replace all MCP servers with agent-recorder hub.
 */
async function handleHubify(
  configPath: string,
  configKind: "v2" | "legacy",
  existingConfig: Record<string, unknown>,
  isNewFile: boolean,
  expectedUrl: string,
  options: ConfigureClaudeOptions
): Promise<void> {
  // Transform config to hubify mode
  const hubifyResult = hubifyClaudeConfig(existingConfig, expectedUrl);

  // Get mcpServers keys before and after
  const beforeKeys = Object.keys(
    (existingConfig.mcpServers as Record<string, unknown>) ?? {}
  );
  const afterKeys = ["agent-recorder"];

  // Dry run output
  if (options.dryRun) {
    console.log("Dry run - no changes will be made\n");
    console.log(`Config file: ${formatPath(configPath)} (${configKind})`);
    console.log(`File exists: ${!isNewFile}`);
    console.log("");

    console.log("Would import providers:");
    if (hubifyResult.importedKeys.length === 0) {
      console.log("  (none - no existing MCP servers found)");
    } else {
      for (const key of hubifyResult.importedKeys) {
        const provider = hubifyResult.providers.find((p) => p.id === key);
        if (provider) {
          console.log(
            `  - ${key} (${provider.type}${provider.type === "http" ? `: ${provider.url}` : ""})`
          );
        }
      }
    }
    console.log("");

    console.log("Would update mcpServers:");
    console.log(`  Before: [${beforeKeys.join(", ") || "empty"}]`);
    console.log(`  After:  [${afterKeys.join(", ")}]`);
    console.log("");

    console.log(`Would write ${hubifyResult.providers.length} provider(s) to:`);
    console.log(`  ${formatPath(getDefaultProvidersPath())}`);

    return;
  }

  // Create backup if file exists (in custom location if specified)
  let backupPath: string | null = null;
  if (!isNewFile) {
    if (options.backupDir) {
      // Custom backup directory
      const backupDir = options.backupDir;
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14);
      const basename = path.basename(configPath);
      backupPath = path.join(backupDir, `${basename}.bak-${timestamp}`);
      fs.copyFileSync(configPath, backupPath);
    } else {
      // Default backup alongside original file
      backupPath = createBackup(configPath);
    }
  }

  // Write updated Claude config
  writeJsonFileAtomic(configPath, hubifyResult.newClaudeConfig);

  // Merge providers into providers.json
  const providersPath = getDefaultProvidersPath();
  const existingProviders = readProvidersFile(providersPath);
  const mergedProviders = mergeProviders(
    existingProviders,
    hubifyResult.providers
  );
  writeProvidersFile(mergedProviders, providersPath);

  // Report results
  console.log("Hubify mode: replaced all MCP servers with agent-recorder hub");
  console.log("");
  console.log(`Config file: ${formatPath(configPath)} (${configKind})`);
  if (backupPath) {
    console.log(`Backup:      ${formatPath(backupPath)}`);
  }
  console.log("");

  console.log(`Imported ${hubifyResult.importedKeys.length} provider(s):`);
  if (hubifyResult.importedKeys.length === 0) {
    console.log("  (none - no existing MCP servers found)");
  } else {
    for (const key of hubifyResult.importedKeys) {
      const provider = hubifyResult.providers.find((p) => p.id === key);
      if (provider) {
        console.log(
          `  - ${key} (${provider.type}${provider.type === "http" ? `: ${provider.url}` : ""})`
        );
      }
    }
  }

  if (hubifyResult.skippedKeys.length > 0) {
    console.log("");
    console.log(`Skipped ${hubifyResult.skippedKeys.length} key(s):`);
    for (const key of hubifyResult.skippedKeys) {
      console.log(`  - ${key} (already agent-recorder)`);
    }
  }

  console.log("");
  console.log("mcpServers updated:");
  console.log(`  Before: [${beforeKeys.join(", ") || "empty"}]`);
  console.log(`  After:  [${afterKeys.join(", ")}]`);
  console.log("");

  console.log(`Providers file: ${formatPath(providersPath)}`);
  console.log(`Total providers: ${mergedProviders.providers.length}`);
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
