/**
 * Configure wrap command - wrap Claude Code MCP servers with Agent Recorder proxy.
 * Supports router mode for multiple upstream servers.
 */

import {
  loadConfig,
  loadUpstreamsRegistry,
  saveUpstreamsRegistry,
  registerUrlServer,
  getProxyUrl,
  detectClaudeConfig,
  readJsonFile,
  writeJsonFileAtomic,
} from "@agent-recorder/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { formatPath } from "../config/claude-paths.js";

export interface ConfigureWrapOptions {
  all?: boolean;
  only?: string;
  dryRun?: boolean;
  undo?: boolean;
}

/**
 * Find most recent backup file.
 */
function findLatestBackup(configPath: string): string | null {
  const dir = path.dirname(configPath);
  const basename = path.basename(configPath);

  if (!fs.existsSync(dir)) {
    return null;
  }

  const files = fs.readdirSync(dir);
  const backupPattern = new RegExp(
    `^${basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.agent-recorder\\.bak(-\\d+)?$`
  );

  const backups = files
    .filter((f) => backupPattern.test(f))
    .map((f) => path.join(dir, f))
    .sort()
    .reverse();

  return backups.length > 0 ? (backups[0] ?? null) : null;
}

/**
 * Create numbered backup (e.g., .agent-recorder.bak, .agent-recorder.bak-2, etc.)
 */
function createNumberedBackup(filePath: string): string {
  const baseBackup = `${filePath}.agent-recorder.bak`;

  if (!fs.existsSync(baseBackup)) {
    fs.copyFileSync(filePath, baseBackup);
    return baseBackup;
  }

  // Find next available number
  let num = 2;
  while (fs.existsSync(`${baseBackup}-${num}`)) {
    num++;
  }

  const numberedBackup = `${baseBackup}-${num}`;
  fs.copyFileSync(filePath, numberedBackup);
  return numberedBackup;
}

/**
 * Wrap MCP servers with Agent Recorder proxy.
 */
export async function configureWrapCommand(
  options: ConfigureWrapOptions = {}
): Promise<void> {
  const config = loadConfig();
  const upstreamsPath = config.upstreamsPath;

  // Detect Claude config
  const detected = detectClaudeConfig();
  if (detected.kind === "none" || !detected.path) {
    console.error("Error: No Claude Code config found.");
    console.error("Run 'agent-recorder configure claude' first.");
    return;
  }

  const configPath = detected.path;

  // Handle undo
  if (options.undo) {
    const latestBackup = findLatestBackup(configPath);
    if (!latestBackup) {
      console.error("Error: No backup found to restore from.");
      return;
    }

    if (options.dryRun) {
      console.log("Dry run - would restore from:");
      console.log(`  ${formatPath(latestBackup)}`);
      return;
    }

    fs.copyFileSync(latestBackup, configPath);
    console.log("Restored config from backup:");
    console.log(`  ${formatPath(latestBackup)}`);
    console.log("");
    console.log("Restart Claude Code to apply changes.");
    return;
  }

  // Read config
  const configData = readJsonFile(configPath);
  if (!configData) {
    console.error(`Error: Could not read config at ${formatPath(configPath)}`);
    return;
  }

  // Get mcpServers
  const mcpServers = configData.mcpServers as
    | Record<string, unknown>
    | undefined;
  if (!mcpServers || typeof mcpServers !== "object") {
    console.error("Error: No mcpServers section found in config.");
    return;
  }

  // Filter servers to wrap
  const serverKeys = Object.keys(mcpServers);
  let targetServers: string[];

  if (options.only) {
    targetServers = options.only.split(",").map((k) => k.trim());
  } else {
    targetServers = serverKeys;
  }

  // Load existing upstreams
  const upstreamsRegistry = loadUpstreamsRegistry(upstreamsPath);

  // Process each server
  const wrapped: string[] = [];
  const skippedCommand: string[] = [];
  const skippedNotFound: string[] = [];

  const newMcpServers: Record<string, unknown> = { ...mcpServers };

  for (const serverKey of targetServers) {
    const entry = mcpServers[serverKey];

    if (!entry || typeof entry !== "object") {
      skippedNotFound.push(serverKey);
      continue;
    }

    const serverEntry = entry as Record<string, unknown>;

    // Skip command-based servers
    if (serverEntry.command) {
      skippedCommand.push(serverKey);
      continue;
    }

    // Wrap URL-based servers
    if (typeof serverEntry.url === "string") {
      const originalUrl = serverEntry.url;

      // Save to upstreams registry
      upstreamsRegistry[serverKey] = { url: originalUrl };

      // Rewrite URL with upstream param (using shared utility)
      const proxyUrl = getProxyUrl(serverKey, config.mcpProxyPort);
      newMcpServers[serverKey] = {
        ...serverEntry,
        url: proxyUrl,
      };

      wrapped.push(serverKey);
    } else {
      skippedNotFound.push(serverKey);
    }
  }

  // Prepare new config
  const newConfig = {
    ...configData,
    mcpServers: newMcpServers,
  };

  // Dry run summary
  if (options.dryRun) {
    console.log("Dry run - no changes will be made\n");
    console.log(`Config file: ${formatPath(configPath)}`);
    console.log(`Upstreams file: ${formatPath(upstreamsPath)}`);
    console.log("");

    if (wrapped.length > 0) {
      console.log(`Would wrap ${wrapped.length} server(s):`);
      for (const key of wrapped) {
        const entry = mcpServers[key] as Record<string, unknown>;
        console.log(`  - ${key}`);
        console.log(`      Original: ${entry.url}`);
        console.log(`      Proxy: ${getProxyUrl(key, config.mcpProxyPort)}`);
      }
      console.log("");
    }

    if (skippedCommand.length > 0) {
      console.log(
        `Would skip ${skippedCommand.length} command-based server(s):`
      );
      for (const key of skippedCommand) {
        console.log(`  - ${key}`);
      }
      console.log("");
    }

    if (skippedNotFound.length > 0) {
      console.log(`Would skip ${skippedNotFound.length} not found/invalid:`);
      for (const key of skippedNotFound) {
        console.log(`  - ${key}`);
      }
      console.log("");
    }

    return;
  }

  // Nothing to wrap
  if (wrapped.length === 0) {
    console.log("No URL-based servers found to wrap.");
    if (skippedCommand.length > 0) {
      console.log(
        `Skipped ${skippedCommand.length} command-based server(s) (not supported yet).`
      );
    }
    return;
  }

  // Create backup
  const backupPath = createNumberedBackup(configPath);

  // Write upstreams registry
  saveUpstreamsRegistry(upstreamsPath, upstreamsRegistry);

  // Write config
  writeJsonFileAtomic(configPath, newConfig);

  // Report results
  console.log(`Wrapped ${wrapped.length} server(s):`);
  for (const key of wrapped) {
    console.log(`  - ${key}`);
  }
  console.log("");

  if (skippedCommand.length > 0) {
    console.log(
      `Skipped ${skippedCommand.length} command-based server(s) (not supported yet):`
    );
    for (const key of skippedCommand) {
      console.log(`  - ${key}`);
    }
    console.log("");
  }

  console.log(`Config: ${formatPath(configPath)}`);
  console.log(`Backup: ${formatPath(backupPath)}`);
  console.log(`Upstreams: ${formatPath(upstreamsPath)}`);
  console.log("");
  console.log("Next: restart Claude Code");
  console.log("");
  console.log("To undo: agent-recorder configure wrap --undo");
}
