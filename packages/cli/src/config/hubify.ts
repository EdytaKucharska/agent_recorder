/**
 * Hubify transformation logic.
 * Extracts MCP servers from Claude config and converts to providers.
 */

import type { Provider, ProvidersFile } from "@agent-recorder/core";

export interface McpServerEntry {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface HubifyResult {
  /** New Claude config with only agent-recorder MCP entry */
  newClaudeConfig: Record<string, unknown>;
  /** Providers extracted from original config */
  providers: Provider[];
  /** Keys that were imported as providers */
  importedKeys: string[];
  /** Keys that were skipped (e.g., agent-recorder itself) */
  skippedKeys: string[];
}

/**
 * Extract providers from Claude config mcpServers.
 * Converts each MCP server entry to a Provider.
 *
 * @param mcpServers - The mcpServers object from Claude config
 * @returns Array of providers
 */
export function extractProviders(
  mcpServers: Record<string, unknown>
): Provider[] {
  const providers: Provider[] = [];

  for (const [key, entry] of Object.entries(mcpServers)) {
    // Skip agent-recorder itself
    if (key === "agent-recorder") {
      continue;
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const serverEntry = entry as McpServerEntry;

    // HTTP provider (has url field)
    if (typeof serverEntry.url === "string") {
      const httpProvider: Provider = {
        id: key,
        type: "http",
        url: serverEntry.url,
        ...(serverEntry.headers && { headers: serverEntry.headers }),
      };
      providers.push(httpProvider);
      continue;
    }

    // Stdio provider (has command field)
    if (typeof serverEntry.command === "string") {
      const args = Array.isArray(serverEntry.args)
        ? (serverEntry.args as string[])
        : undefined;

      const env =
        serverEntry.env &&
        typeof serverEntry.env === "object" &&
        !Array.isArray(serverEntry.env)
          ? (serverEntry.env as Record<string, string>)
          : undefined;

      const stdioProvider: Provider = {
        id: key,
        type: "stdio",
        command: serverEntry.command,
        ...(args && { args }),
        ...(env && { env }),
      };
      providers.push(stdioProvider);
      continue;
    }
  }

  return providers;
}

/**
 * Transform Claude config for hubify mode.
 * Replaces mcpServers with only agent-recorder entry.
 * Preserves all other Claude config fields.
 *
 * @param claudeConfig - Original Claude config
 * @param agentRecorderUrl - URL for agent-recorder MCP entry
 * @returns Hubify transformation result
 */
export function hubifyClaudeConfig(
  claudeConfig: Record<string, unknown>,
  agentRecorderUrl: string
): HubifyResult {
  // Extract existing mcpServers
  const mcpServers =
    claudeConfig.mcpServers &&
    typeof claudeConfig.mcpServers === "object" &&
    !Array.isArray(claudeConfig.mcpServers)
      ? (claudeConfig.mcpServers as Record<string, unknown>)
      : {};

  // Extract providers from existing servers
  const providers = extractProviders(mcpServers);

  // Track imported and skipped keys
  const importedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const key of Object.keys(mcpServers)) {
    if (key === "agent-recorder") {
      skippedKeys.push(key);
    } else if (providers.some((p) => p.id === key)) {
      importedKeys.push(key);
    }
  }

  // Create new config with only agent-recorder
  const newClaudeConfig = {
    ...claudeConfig,
    mcpServers: {
      "agent-recorder": {
        url: agentRecorderUrl,
      },
    },
  };

  return {
    newClaudeConfig,
    providers,
    importedKeys,
    skippedKeys,
  };
}

/**
 * Merge providers into providers file.
 * Upserts providers by ID.
 *
 * @param existingFile - Existing providers file
 * @param newProviders - Providers to merge
 * @returns Updated providers file
 */
export function mergeProviders(
  existingFile: ProvidersFile,
  newProviders: Provider[]
): ProvidersFile {
  const providerMap = new Map<string, Provider>();

  // Add existing providers
  for (const provider of existingFile.providers) {
    providerMap.set(provider.id, provider);
  }

  // Upsert new providers
  for (const provider of newProviders) {
    providerMap.set(provider.id, provider);
  }

  return {
    version: 1,
    providers: Array.from(providerMap.values()),
  };
}
