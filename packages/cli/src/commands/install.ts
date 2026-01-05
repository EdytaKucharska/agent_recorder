/**
 * Install command - set up ~/.agent-recorder/ and print configuration.
 * This command is idempotent - it won't overwrite existing files.
 * Automatically configures Claude Code with hubify mode unless --no-configure is specified.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  readProvidersFile,
  writeProvidersFile,
  getDefaultProvidersPath,
  discoverAllConfigs,
  getServerType,
  type McpServerConfig,
  type Provider,
  type HttpProvider,
} from "@agent-recorder/core";
import {
  detectClaudeConfig,
  readJsonFile,
  writeJsonFileAtomic,
  createBackup,
  formatPath,
} from "../config/claude-paths.js";
import { hubifyClaudeConfig, mergeProviders } from "../config/hubify.js";

/** Default .env file template */
const ENV_TEMPLATE = `# Agent Recorder Configuration
# See docs/bootstrap.md for more options

# Ports
AR_LISTEN_PORT=8787
AR_MCP_PROXY_PORT=8788

# Database path (default is ~/.agent-recorder/agent-recorder.sqlite)
# AR_DB_PATH=

# Downstream MCP server (optional)
# AR_DOWNSTREAM_MCP_URL=http://127.0.0.1:9999

# Debug logging for MCP proxy (1 to enable)
# AR_DEBUG_PROXY=1
`;

export interface InstallOptions {
  /** Skip automatic Claude Code configuration (default: false) */
  noConfigure?: boolean;
}

/**
 * Install Agent Recorder - create data directory and env file template.
 * This command is idempotent:
 * - Creates ~/.agent-recorder/ if it doesn't exist
 * - Creates ~/.agent-recorder/.env ONLY if it doesn't exist
 * - Never overwrites user files
 * - Automatically configures Claude Code with hubify mode unless --no-configure
 */
export async function installCommand(
  options: InstallOptions = {}
): Promise<void> {
  const config = loadConfig();
  const dataDir = join(homedir(), ".agent-recorder");
  const envFile = join(dataDir, ".env");
  const upstreamsFile = join(dataDir, "upstreams.json");

  // Create data directory if missing
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`Created: ${dataDir}`);
  } else {
    console.log(`Already exists: ${dataDir}`);
  }

  // Create .env file ONLY if it doesn't exist
  if (!existsSync(envFile)) {
    writeFileSync(envFile, ENV_TEMPLATE);
    console.log(`Created: ${envFile}`);
  } else {
    console.log(`Already exists: ${envFile}`);
  }

  // Create upstreams.json ONLY if it doesn't exist
  if (!existsSync(upstreamsFile)) {
    writeFileSync(upstreamsFile, "{}\n");
    console.log(`Created: ${upstreamsFile}`);
  } else {
    console.log(`Already exists: ${upstreamsFile}`);
  }

  console.log("");

  // Automatically configure Claude Code with hubify mode unless --no-configure
  if (!options.noConfigure) {
    await runAutoHubify(config);
  } else {
    console.log("Skipped Claude Code configuration (--no-configure specified)");
    console.log("");
    console.log("To configure Claude Code manually, run:");
    console.log("  agent-recorder configure claude --hubify");
  }

  // Print next steps with clear quick-start
  console.log(`
Agent Recorder installed!

Quick start:
  agent-recorder start --daemon   # Start recording
  agent-recorder doctor           # Verify setup
  # Restart Claude Code to apply changes

Provider management:
  agent-recorder list             # Show configured providers
  agent-recorder add <name> <url> # Add an MCP server
  agent-recorder remove <name>    # Remove a provider

Data directory: ${dataDir}
`);
}

/**
 * Convert a discovered MCP server to a Provider.
 */
function serverToProvider(server: McpServerConfig): Provider | null {
  const serverType = getServerType(server);

  if (serverType === "stdio") {
    // Stdio not supported yet - return null
    return null;
  }

  if (server.url) {
    const httpProvider: HttpProvider = {
      id: server.key,
      type: "http",
      url: server.url,
      ...(server.headers && { headers: server.headers }),
    };
    return httpProvider;
  }

  return null;
}

/**
 * Import servers from non-Claude sources (Cursor, VS Code, project-level).
 * Returns the list of providers that were imported.
 */
function importFromOtherSources(providersPath: string): {
  imported: Provider[];
  skipped: { key: string; reason: string }[];
} {
  const discovery = discoverAllConfigs();
  const imported: Provider[] = [];
  const skipped: { key: string; reason: string }[] = [];

  // Get servers from non-Claude sources
  const otherServers = discovery.allServers.filter(
    (s) =>
      s.source !== "claude-code-v2" &&
      s.source !== "claude-code-legacy" &&
      s.key !== "agent-recorder"
  );

  if (otherServers.length === 0) {
    return { imported, skipped };
  }

  // Load existing providers
  const existingProviders = readProvidersFile(providersPath);
  const existingIds = new Set(existingProviders.providers.map((p) => p.id));

  for (const server of otherServers) {
    // Skip if already exists
    if (existingIds.has(server.key)) {
      skipped.push({ key: server.key, reason: "already exists" });
      continue;
    }

    const provider = serverToProvider(server);
    if (provider) {
      imported.push(provider);
      existingIds.add(provider.id); // Prevent duplicates in same batch
    } else {
      skipped.push({ key: server.key, reason: "stdio not supported" });
    }
  }

  // Merge and write if we have new providers
  if (imported.length > 0) {
    const merged = mergeProviders(existingProviders, imported);
    writeProvidersFile(merged, providersPath);
  }

  return { imported, skipped };
}

/**
 * Automatically configure Claude Code with hubify mode.
 * This is the equivalent of running: agent-recorder configure claude --hubify
 */
async function runAutoHubify(
  config: ReturnType<typeof loadConfig>
): Promise<void> {
  const expectedUrl = `http://127.0.0.1:${config.mcpProxyPort}/`;

  // Detect Claude config
  const detected = detectClaudeConfig();

  if (detected.kind === "none" || !detected.path) {
    console.log("No Claude Code config found.");
    console.log("Claude Code will need to be configured manually.");
    console.log("");
    console.log("To configure later, run:");
    console.log("  agent-recorder configure claude --hubify");
    return;
  }

  const configPath = detected.path;

  // Read existing config
  const existingConfig = readJsonFile(configPath);
  if (existingConfig === null) {
    console.log(`Error: Could not read config at ${formatPath(configPath)}`);
    return;
  }

  // Transform config to hubify mode
  const hubifyResult = hubifyClaudeConfig(existingConfig, expectedUrl);

  // Get mcpServers keys before and after
  const beforeKeys = Object.keys(
    (existingConfig.mcpServers as Record<string, unknown>) ?? {}
  );
  const afterKeys = ["agent-recorder"];

  // Create backup
  const backupPath = createBackup(configPath);

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
  console.log("Configured Claude Code with hubify mode");
  console.log("");
  console.log(`Config file: ${formatPath(configPath)} (${detected.kind})`);
  console.log(`Backup:      ${formatPath(backupPath)}`);
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

  // Also import from other sources (Cursor, VS Code, project-level)
  const otherResult = importFromOtherSources(providersPath);

  if (otherResult.imported.length > 0 || otherResult.skipped.length > 0) {
    console.log("Additional sources discovered:");
    console.log("------------------------------");

    if (otherResult.imported.length > 0) {
      console.log(
        `Imported ${otherResult.imported.length} server(s) from other configs:`
      );
      for (const provider of otherResult.imported) {
        if (provider.type === "http") {
          console.log(`  ✓ ${provider.id}: ${provider.url}`);
        }
      }
    }

    if (otherResult.skipped.length > 0) {
      console.log(`Skipped ${otherResult.skipped.length} server(s):`);
      for (const { key, reason } of otherResult.skipped) {
        console.log(`  ○ ${key}: ${reason}`);
      }
    }
    console.log("");
  }
}
