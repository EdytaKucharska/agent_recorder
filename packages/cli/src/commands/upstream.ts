/**
 * Upstream commands - manage upstreams for router mode.
 * Supports auth headers for OAuth-protected MCP servers.
 */

import {
  loadUpstreamsRegistry,
  saveUpstreamsRegistry,
  getDefaultUpstreamsPath,
  type UpstreamEntry,
} from "@agent-recorder/core";

export interface UpstreamAddOptions {
  /** Force overwrite if upstream already exists */
  force?: boolean;
  /** Headers to include (can be specified multiple times) */
  header?: string[];
}

/**
 * Parse header string like "Authorization: Bearer xxx" into key-value pair.
 */
function parseHeader(headerStr: string): { key: string; value: string } | null {
  const colonIndex = headerStr.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }
  const key = headerStr.slice(0, colonIndex).trim();
  const value = headerStr.slice(colonIndex + 1).trim();
  if (!key || !value) {
    return null;
  }
  return { key, value };
}

/**
 * Add an upstream to router mode configuration.
 * Supports optional auth headers for OAuth-protected servers.
 */
export async function upstreamAddCommand(
  name: string,
  url: string,
  options: UpstreamAddOptions = {}
): Promise<void> {
  const upstreamsPath = getDefaultUpstreamsPath();

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  // Load existing upstreams
  const registry = loadUpstreamsRegistry(upstreamsPath);

  // Check if upstream already exists
  if (name in registry && !options.force) {
    console.error(`Upstream "${name}" already exists.`);
    console.error(`Use --force to overwrite, or choose a different name.`);
    process.exit(1);
  }

  // Parse headers
  let headers: Record<string, string> | undefined;
  if (options.header && options.header.length > 0) {
    headers = {};
    for (const headerStr of options.header) {
      const parsed = parseHeader(headerStr);
      if (!parsed) {
        console.error(`Invalid header format: "${headerStr}"`);
        console.error(`Expected format: "Header-Name: value"`);
        process.exit(1);
      }
      headers[parsed.key] = parsed.value;
    }
  }

  // Create upstream entry
  const entry: UpstreamEntry = { url };
  if (headers) {
    entry.headers = headers;
  }

  // Add or replace
  const isUpdate = name in registry;
  registry[name] = entry;

  // Save
  saveUpstreamsRegistry(upstreamsPath, registry);

  if (isUpdate) {
    console.log(`Updated upstream: ${name}`);
  } else {
    console.log(`Added upstream: ${name}`);
  }
  console.log(`  URL: ${url}`);
  if (headers) {
    console.log(`  Headers: ${Object.keys(headers).join(", ")}`);
  }
  console.log("");
  console.log(`Total upstreams: ${Object.keys(registry).length}`);
  console.log("");

  // Show next steps
  console.log("Next steps:");
  console.log("  1. Restart daemon: agent-recorder restart");
  console.log(
    `  2. Configure Claude Code to use: http://127.0.0.1:8788/?upstream=${name}`
  );
  console.log("");
  console.log(
    "Note: Some MCP servers (e.g., Figma remote) only support OAuth authentication,"
  );
  console.log(
    "      not Personal Access Tokens. For Figma, consider using the Desktop MCP"
  );
  console.log(
    "      server (http://127.0.0.1:3845/mcp) or a third-party MCP like Figma-Context-MCP."
  );
}

/**
 * Remove an upstream from router mode configuration.
 */
export async function upstreamRemoveCommand(name: string): Promise<void> {
  const upstreamsPath = getDefaultUpstreamsPath();

  // Load existing upstreams
  const registry = loadUpstreamsRegistry(upstreamsPath);

  // Check if exists
  if (!(name in registry)) {
    console.error(`Upstream "${name}" not found.`);
    console.log("");
    console.log("Available upstreams:");
    for (const key of Object.keys(registry)) {
      console.log(`  - ${key}`);
    }
    process.exit(1);
  }

  // Remove
  delete registry[name];
  saveUpstreamsRegistry(upstreamsPath, registry);

  console.log(`Removed upstream: ${name}`);
  console.log(`Remaining upstreams: ${Object.keys(registry).length}`);
  console.log("");
  console.log("Restart daemon to apply changes.");
}

/**
 * List all configured upstreams.
 */
export async function upstreamListCommand(): Promise<void> {
  const upstreamsPath = getDefaultUpstreamsPath();
  const registry = loadUpstreamsRegistry(upstreamsPath);

  console.log("Configured Upstreams (Router Mode)");
  console.log("==================================");
  console.log("");

  const keys = Object.keys(registry);
  if (keys.length === 0) {
    console.log("No upstreams configured.");
    console.log("");
    console.log("Add an upstream with:");
    console.log("  agent-recorder upstream add <name> <url>");
    console.log("");
    console.log("For OAuth-protected servers, add auth headers:");
    console.log(
      '  agent-recorder upstream add figma https://mcp.figma.com/mcp --header "Authorization: Bearer <token>"'
    );
    return;
  }

  for (const key of keys) {
    const entry = registry[key]!;
    console.log(`  ${key}`);
    console.log(`    URL: ${entry.url}`);
    if (entry.headers) {
      const headerKeys = Object.keys(entry.headers);
      // Mask auth values for security
      const maskedHeaders = headerKeys
        .map((h) => {
          const value = entry.headers![h]!;
          if (h.toLowerCase() === "authorization") {
            return `${h}: ${value.slice(0, 15)}...`;
          }
          return `${h}: ${value}`;
        })
        .join(", ");
      console.log(`    Headers: ${maskedHeaders}`);
    }
  }

  console.log("");
  console.log(`Total: ${keys.length} upstream(s)`);
  console.log("");
  console.log("Usage in Claude Code:");
  console.log("  http://127.0.0.1:8788/?upstream=<name>");

  // Check if any upstreams point to known OAuth-only servers
  const oauthOnlyPatterns = ["mcp.figma.com"];
  const oauthUpstreams = keys.filter((key) => {
    const url = registry[key]?.url ?? "";
    return oauthOnlyPatterns.some((pattern) => url.includes(pattern));
  });

  if (oauthUpstreams.length > 0) {
    console.log("");
    console.log("⚠ OAuth-only upstreams detected:");
    for (const key of oauthUpstreams) {
      console.log(`  - ${key}: Figma remote MCP only supports OAuth, not PATs`);
    }
    console.log("");
    console.log("Alternatives for Figma:");
    console.log(
      "  - Desktop MCP server: http://127.0.0.1:3845/mcp (requires Figma app)"
    );
    console.log(
      "  - Figma-Context-MCP: github.com/GLips/Figma-Context-MCP (supports PAT)"
    );
  }
}
