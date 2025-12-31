/**
 * Shared utilities for wrapping MCP servers with Agent Recorder proxy.
 * Used by both CLI command and auto-wrap manager.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface UpstreamsRegistry {
  [serverKey: string]: {
    url: string;
  };
}

/**
 * Load upstreams registry from file.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function loadUpstreamsRegistry(upstreamsPath: string): UpstreamsRegistry {
  try {
    if (!fs.existsSync(upstreamsPath)) {
      return {};
    }
    const content = fs.readFileSync(upstreamsPath, "utf-8");
    return JSON.parse(content) as UpstreamsRegistry;
  } catch {
    return {};
  }
}

/**
 * Save upstreams registry to file.
 * Creates directory if it doesn't exist.
 */
export function saveUpstreamsRegistry(
  upstreamsPath: string,
  registry: UpstreamsRegistry
): void {
  const dir = path.dirname(upstreamsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(registry, null, 2) + "\n";
  fs.writeFileSync(upstreamsPath, content, "utf-8");
}

/**
 * Check if a server is already wrapped in the upstreams registry.
 */
export function isAlreadyWrapped(
  serverKey: string,
  upstreamsPath: string
): boolean {
  const registry = loadUpstreamsRegistry(upstreamsPath);
  return serverKey in registry;
}

/**
 * Get the proxy URL for a given server key.
 */
export function getProxyUrl(serverKey: string, mcpProxyPort: number): string {
  return `http://127.0.0.1:${mcpProxyPort}/?upstream=${serverKey}`;
}

/**
 * Register a URL-based server in the upstreams registry.
 * Returns the proxy URL that should replace the original URL.
 */
export function registerUrlServer(
  serverKey: string,
  originalUrl: string,
  upstreamsPath: string,
  mcpProxyPort: number
): string {
  // Load existing registry
  const registry = loadUpstreamsRegistry(upstreamsPath);

  // Add server to registry
  registry[serverKey] = { url: originalUrl };

  // Save registry
  saveUpstreamsRegistry(upstreamsPath, registry);

  // Return proxy URL
  return getProxyUrl(serverKey, mcpProxyPort);
}

/**
 * Unregister a server from the upstreams registry.
 */
export function unregisterServer(
  serverKey: string,
  upstreamsPath: string
): void {
  const registry = loadUpstreamsRegistry(upstreamsPath);

  if (serverKey in registry) {
    delete registry[serverKey];
    saveUpstreamsRegistry(upstreamsPath, registry);
  }
}

/**
 * Get the original URL for a wrapped server.
 * Returns null if server is not wrapped.
 */
export function getOriginalUrl(
  serverKey: string,
  upstreamsPath: string
): string | null {
  const registry = loadUpstreamsRegistry(upstreamsPath);
  return registry[serverKey]?.url ?? null;
}
