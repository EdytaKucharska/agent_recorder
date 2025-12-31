/**
 * Auto-Wrap Manager
 * Automatically discovers and wraps MCP servers from Claude Code config.
 * Supports URL-based servers (stdio support in later phase).
 */

import type Database from "better-sqlite3";
import type { Config } from "@agent-recorder/core";
import {
  registerUrlServer,
  unregisterServer,
  isAlreadyWrapped,
  detectClaudeConfig,
  readJsonFile,
  writeJsonFileAtomic,
} from "@agent-recorder/core";

interface WrappedServer {
  key: string;
  type: "url" | "stdio";
  originalUrl?: string;
  originalCommand?: { command: string; args: string[] };
}

interface DiscoveredServers {
  url: Map<string, string>;
  stdio: Map<string, { command: string; args: string[] }>;
}

export interface AutoWrapManagerOptions {
  config: Config;
  sessionId: string;
  db: Database.Database;
}

export class AutoWrapManager {
  private wrappedServers: Map<string, WrappedServer> = new Map();
  private config: Config;
  private sessionId: string;
  private db: Database.Database;
  private claudeConfigPath: string | null = null;
  private originalClaudeConfig: unknown = null;

  constructor(options: AutoWrapManagerOptions) {
    this.config = options.config;
    this.sessionId = options.sessionId;
    this.db = options.db;
  }

  /**
   * Discover servers from Claude config and wrap them.
   * Fail-open: logs errors but doesn't throw.
   */
  async initialize(): Promise<void> {
    try {
      // Detect Claude config
      const detected = detectClaudeConfig();
      if (detected.kind === "none" || !detected.path) {
        console.log(
          "[AutoWrap] No Claude Code config found - skipping auto-wrap"
        );
        return;
      }

      this.claudeConfigPath = detected.path;
      console.log(`[AutoWrap] Found Claude config: ${detected.path}`);

      // Read and backup original config
      const configData = readJsonFile(this.claudeConfigPath);
      if (!configData) {
        console.error("[AutoWrap] Could not read Claude config - skipping");
        return;
      }

      this.originalClaudeConfig = structuredClone(configData);

      // Discover servers
      const discovered = await this.discoverServers(configData);

      console.log(
        `[AutoWrap] Discovered ${discovered.url.size} URL server(s), ${discovered.stdio.size} stdio server(s)`
      );

      // Wrap URL servers
      let wrappedCount = 0;
      for (const [key, url] of discovered.url.entries()) {
        try {
          await this.wrapUrlServer(key, url);
          wrappedCount++;
        } catch (error) {
          console.error(
            `[AutoWrap] Failed to wrap server "${key}":`,
            error instanceof Error ? error.message : "Unknown error"
          );
        }
      }

      if (wrappedCount > 0) {
        console.log(`[AutoWrap] Successfully wrapped ${wrappedCount} server(s)`);
      }

      // TODO: Wrap stdio servers (later phase)
      if (discovered.stdio.size > 0) {
        console.log(
          `[AutoWrap] Skipping ${discovered.stdio.size} stdio server(s) (not yet supported)`
        );
      }
    } catch (error) {
      console.error(
        "[AutoWrap] Initialization failed:",
        error instanceof Error ? error.message : "Unknown error"
      );
      console.error("Continuing in manual wrap mode...");
    }
  }

  /**
   * Re-discover and wrap new servers (for hot-reload).
   */
  async handleConfigChange(): Promise<void> {
    console.log("[AutoWrap] Config change detected - re-wrapping...");

    try {
      if (!this.claudeConfigPath) {
        console.error("[AutoWrap] No config path - cannot reload");
        return;
      }

      // Read updated config
      const configData = readJsonFile(this.claudeConfigPath);
      if (!configData) {
        console.error("[AutoWrap] Could not read updated config");
        return;
      }

      // Discover servers
      const discovered = await this.discoverServers(configData);

      // Find new servers (not already wrapped)
      const newServers = new Map<string, string>();
      for (const [key, url] of discovered.url.entries()) {
        if (!this.wrappedServers.has(key)) {
          newServers.set(key, url);
        }
      }

      if (newServers.size === 0) {
        console.log("[AutoWrap] No new servers to wrap");
        return;
      }

      // Wrap new servers
      let wrappedCount = 0;
      for (const [key, url] of newServers.entries()) {
        try {
          await this.wrapUrlServer(key, url);
          wrappedCount++;
        } catch (error) {
          console.error(
            `[AutoWrap] Failed to wrap new server "${key}":`,
            error instanceof Error ? error.message : "Unknown error"
          );
        }
      }

      console.log(`[AutoWrap] Wrapped ${wrappedCount} new server(s)`);
    } catch (error) {
      console.error(
        "[AutoWrap] Config reload failed:",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  /**
   * Cleanup: restore config, unregister servers.
   */
  async cleanup(): Promise<void> {
    try {
      console.log("[AutoWrap] Cleaning up...");

      // Unregister all wrapped servers
      for (const [key, server] of this.wrappedServers.entries()) {
        if (server.type === "url") {
          unregisterServer(key, this.config.upstreamsPath);
        }
      }

      // Restore original Claude config
      if (this.claudeConfigPath && this.originalClaudeConfig) {
        writeJsonFileAtomic(this.claudeConfigPath, this.originalClaudeConfig);
        console.log("[AutoWrap] Restored original Claude config");
      }

      this.wrappedServers.clear();
    } catch (error) {
      console.error(
        "[AutoWrap] Cleanup failed:",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  /**
   * Discover MCP servers from Claude config.
   */
  private async discoverServers(
    configData: unknown
  ): Promise<DiscoveredServers> {
    const url = new Map<string, string>();
    const stdio = new Map<string, { command: string; args: string[] }>();

    if (
      !configData ||
      typeof configData !== "object" ||
      Array.isArray(configData)
    ) {
      return { url, stdio };
    }

    const config = configData as Record<string, unknown>;
    const mcpServers = config.mcpServers;

    if (
      !mcpServers ||
      typeof mcpServers !== "object" ||
      Array.isArray(mcpServers)
    ) {
      return { url, stdio };
    }

    const servers = mcpServers as Record<string, unknown>;

    for (const [key, entry] of Object.entries(servers)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const serverEntry = entry as Record<string, unknown>;

      // URL-based server
      if (typeof serverEntry.url === "string") {
        url.set(key, serverEntry.url);
        continue;
      }

      // Command-based server (stdio)
      if (typeof serverEntry.command === "string") {
        const args = Array.isArray(serverEntry.args)
          ? (serverEntry.args as string[])
          : [];
        stdio.set(key, { command: serverEntry.command, args });
        continue;
      }
    }

    return { url, stdio };
  }

  /**
   * Wrap a single URL-based MCP server.
   */
  private async wrapUrlServer(key: string, url: string): Promise<void> {
    // Check if already wrapped
    if (isAlreadyWrapped(key, this.config.upstreamsPath)) {
      console.log(`[AutoWrap] Server "${key}" already wrapped - skipping`);
      return;
    }

    // Register in upstreams registry
    const proxyUrl = registerUrlServer(
      key,
      url,
      this.config.upstreamsPath,
      this.config.mcpProxyPort
    );

    // Update Claude config to use proxy URL
    if (!this.claudeConfigPath) {
      throw new Error("Claude config path not set");
    }

    const configData = readJsonFile(this.claudeConfigPath);
    if (!configData) {
      throw new Error("Could not read Claude config");
    }

    const config = configData as Record<string, unknown>;
    const mcpServers = config.mcpServers as Record<string, unknown>;
    const serverEntry = mcpServers[key] as Record<string, unknown>;

    // Update URL to proxy
    const newEntry = {
      ...serverEntry,
      url: proxyUrl,
    };

    const newConfig = {
      ...config,
      mcpServers: {
        ...mcpServers,
        [key]: newEntry,
      },
    };

    // Write updated config atomically
    writeJsonFileAtomic(this.claudeConfigPath, newConfig);

    // Track wrapped server
    this.wrappedServers.set(key, {
      key,
      type: "url",
      originalUrl: url,
    });

    console.log(`[AutoWrap] Wrapped "${key}": ${url} -> ${proxyUrl}`);
  }
}
