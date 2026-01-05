/**
 * Add command - easily add an MCP provider to hub mode.
 * Simple command: agent-recorder add <name> <url>
 */

import {
  readProvidersFile,
  writeProvidersFile,
  getDefaultProvidersPath,
  type HttpProvider,
} from "@agent-recorder/core";

export interface AddOptions {
  /** Force overwrite if provider already exists */
  force?: boolean;
}

/**
 * Add an HTTP provider to the hub mode configuration.
 * This is the simplest way to add an MCP server for recording.
 */
export async function addCommand(
  name: string,
  url: string,
  options: AddOptions = {}
): Promise<void> {
  const providersPath = getDefaultProvidersPath();

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  // Load existing providers
  const providersFile = readProvidersFile(providersPath);

  // Check if provider already exists
  const existingIndex = providersFile.providers.findIndex((p) => p.id === name);

  if (existingIndex !== -1 && !options.force) {
    console.error(`Provider "${name}" already exists.`);
    console.error(`Use --force to overwrite, or choose a different name.`);
    process.exit(1);
  }

  // Create new provider
  const newProvider: HttpProvider = {
    id: name,
    type: "http",
    url,
  };

  // Add or replace provider
  if (existingIndex !== -1) {
    providersFile.providers[existingIndex] = newProvider;
    console.log(`Updated provider: ${name}`);
  } else {
    providersFile.providers.push(newProvider);
    console.log(`Added provider: ${name}`);
  }

  // Save
  writeProvidersFile(providersFile, providersPath);

  console.log(`  URL: ${url}`);
  console.log("");
  console.log(`Total providers: ${providersFile.providers.length}`);
  console.log("");

  // Show next steps
  console.log("Next steps:");
  console.log("  1. Restart daemon: agent-recorder restart");
  console.log("  2. Restart Claude Code to pick up new tools");
  console.log("");
  console.log(`Tools from "${name}" will appear as: ${name}.<tool_name>`);
}

/**
 * Remove an MCP provider from hub mode configuration.
 */
export async function removeCommand(name: string): Promise<void> {
  const providersPath = getDefaultProvidersPath();

  // Load existing providers
  const providersFile = readProvidersFile(providersPath);

  // Find provider
  const existingIndex = providersFile.providers.findIndex((p) => p.id === name);

  if (existingIndex === -1) {
    console.error(`Provider "${name}" not found.`);
    console.log("");
    console.log("Available providers:");
    for (const p of providersFile.providers) {
      console.log(`  - ${p.id}`);
    }
    process.exit(1);
  }

  // Remove provider
  providersFile.providers.splice(existingIndex, 1);
  writeProvidersFile(providersFile, providersPath);

  console.log(`Removed provider: ${name}`);
  console.log(`Remaining providers: ${providersFile.providers.length}`);
  console.log("");
  console.log("Restart daemon and Claude Code to apply changes.");
}

/**
 * List all configured providers.
 */
export async function listCommand(): Promise<void> {
  const providersPath = getDefaultProvidersPath();
  const providersFile = readProvidersFile(providersPath);

  console.log("Configured Providers");
  console.log("====================");
  console.log("");

  if (providersFile.providers.length === 0) {
    console.log("No providers configured.");
    console.log("");
    console.log("Add a provider with:");
    console.log("  agent-recorder add <name> <url>");
    return;
  }

  for (const provider of providersFile.providers) {
    if (provider.type === "http") {
      console.log(`  ${provider.id}`);
      console.log(`    URL: ${provider.url}`);
    } else {
      console.log(`  ${provider.id} (${provider.type})`);
    }
  }

  console.log("");
  console.log(`Total: ${providersFile.providers.length} provider(s)`);
}
