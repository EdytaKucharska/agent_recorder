/**
 * Discover command - find all MCP configurations across different sources.
 * Scans Claude Code, Cursor, VS Code, and project-level configs.
 */

import * as os from "node:os";
import {
  discoverAllConfigs,
  getServerType,
  loadConfig,
  type McpServerConfig,
  type DiscoveryResult,
} from "@agent-recorder/core";

interface DiscoverOptions {
  json?: boolean;
  verbose?: boolean;
}

/**
 * Format path for display, replacing home with ~
 */
function formatPath(filePath: string): string {
  const home = os.homedir();
  if (filePath.startsWith(home)) {
    return "~" + filePath.slice(home.length);
  }
  return filePath;
}

/**
 * Check if a server is already wrapped (pointing to agent-recorder proxy).
 */
function isWrapped(server: McpServerConfig, proxyPort: number): boolean {
  if (!server.url) return false;
  try {
    const url = new URL(server.url);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === String(proxyPort)
    );
  } catch {
    return false;
  }
}

/**
 * Get status indicator for a server.
 */
function getServerStatus(
  server: McpServerConfig,
  proxyPort: number
): { icon: string; label: string } {
  const serverType = getServerType(server);

  if (server.key === "agent-recorder") {
    return { icon: "★", label: "agent-recorder" };
  }

  if (isWrapped(server, proxyPort)) {
    return { icon: "↻", label: "wrapped" };
  }

  switch (serverType) {
    case "http":
      return { icon: "✓", label: "can proxy" };
    case "remote":
      return { icon: "✓", label: "remote (can proxy)" };
    case "stdio":
      return { icon: "○", label: "stdio (v2)" };
    default:
      return { icon: "?", label: "unknown" };
  }
}

/**
 * Print discovery results in human-readable format.
 */
function printResults(result: DiscoveryResult, proxyPort: number, verbose: boolean): void {
  console.log("MCP Configuration Discovery");
  console.log("===========================\n");

  // Config sources
  console.log("Config Sources Checked:");
  console.log("-----------------------");

  for (const source of result.sources) {
    const statusIcon = source.exists
      ? source.error
        ? "⚠"
        : "✓"
      : "·";

    const serverCount = source.servers.length;
    const countLabel = source.exists && !source.error
      ? ` (${serverCount} server${serverCount !== 1 ? "s" : ""})`
      : source.error
        ? ` (error: ${source.error})`
        : "";

    console.log(`  ${statusIcon} ${source.name.padEnd(24)}${countLabel}`);

    if (verbose && source.exists) {
      console.log(`    ${formatPath(source.path)}`);
    }
  }
  console.log("");

  // Summary stats
  console.log("Summary:");
  console.log("--------");
  console.log(`  Total servers found:     ${result.allServers.length}`);
  console.log(`  HTTP (local):            ${result.httpServers.length}`);
  console.log(`  HTTP (remote):           ${result.remoteServers.length}`);
  console.log(`  Stdio:                   ${result.stdioServers.length}`);
  console.log("");

  // Detailed server list
  if (result.allServers.length > 0) {
    console.log("Discovered Servers:");
    console.log("-------------------");

    // Group by source for cleaner display
    const bySource = new Map<string, typeof result.allServers>();
    for (const server of result.allServers) {
      const sourceKey = server.source;
      if (!bySource.has(sourceKey)) {
        bySource.set(sourceKey, []);
      }
      bySource.get(sourceKey)!.push(server);
    }

    for (const [sourceType, servers] of bySource) {
      const sourceLabel = getSourceLabel(sourceType);
      console.log(`\n  ${sourceLabel}:`);

      for (const server of servers) {
        const { icon, label } = getServerStatus(server, proxyPort);
        const serverType = getServerType(server);

        let endpoint = "";
        if (server.url) {
          endpoint = server.url;
        } else if (server.command) {
          const args = server.args?.join(" ") ?? "";
          endpoint = `${server.command}${args ? " " + args : ""}`;
          // Truncate long commands
          if (endpoint.length > 50) {
            endpoint = endpoint.slice(0, 47) + "...";
          }
        }

        console.log(`    ${icon} ${server.key.padEnd(20)} ${endpoint}`);
        if (verbose) {
          console.log(`      Type: ${serverType}, Status: ${label}`);
        }
      }
    }
    console.log("");
  }

  // Actionable advice
  printAdvice(result, proxyPort);
}

function getSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    "claude-code-v2": "Claude Code (global)",
    "claude-code-legacy": "Claude Code (legacy)",
    "cursor": "Cursor IDE",
    "vscode-user": "VS Code (user)",
    "project-claude": "Project (.claude)",
    "project-cursor": "Project (.cursor)",
  };
  return labels[source] ?? source;
}

/**
 * Print actionable advice based on discovery results.
 */
function printAdvice(result: DiscoveryResult, proxyPort: number): void {
  const advice: string[] = [];

  // Check for unwrapped HTTP servers
  const unwrappedHttp = result.httpServers.filter(
    (s) => s.key !== "agent-recorder" && !isWrapped(s, proxyPort)
  );

  const unwrappedRemote = result.remoteServers.filter(
    (s) => s.key !== "agent-recorder" && !isWrapped(s, proxyPort)
  );

  if (unwrappedHttp.length > 0 || unwrappedRemote.length > 0) {
    const total = unwrappedHttp.length + unwrappedRemote.length;
    advice.push(
      `${total} HTTP server(s) can be wrapped for observability.`
    );
    advice.push(`Run: agent-recorder install`);
  }

  if (result.stdioServers.length > 0) {
    advice.push(
      `${result.stdioServers.length} stdio server(s) found. Stdio support coming in v2.`
    );
  }

  // Check for servers in non-Claude configs
  const cursorServers = result.allServers.filter((s) => s.source === "cursor");
  if (cursorServers.length > 0) {
    advice.push(
      `Found ${cursorServers.length} server(s) in Cursor config - these need manual import.`
    );
  }

  const vscodeServers = result.allServers.filter((s) => s.source === "vscode-user");
  if (vscodeServers.length > 0) {
    advice.push(
      `Found ${vscodeServers.length} server(s) in VS Code - these need manual import.`
    );
  }

  if (advice.length > 0) {
    console.log("Recommendations:");
    console.log("----------------");
    for (const item of advice) {
      console.log(`  → ${item}`);
    }
    console.log("");
  }

  // Legend
  console.log("Legend:");
  console.log("-------");
  console.log("  ✓ = Can be proxied (HTTP)");
  console.log("  ↻ = Already wrapped through agent-recorder");
  console.log("  ★ = Agent Recorder itself");
  console.log("  ○ = Stdio-based (not yet supported)");
  console.log("  · = Config file not found");
  console.log("  ⚠ = Error reading config");
}

/**
 * Print discovery results as JSON.
 */
function printJson(result: DiscoveryResult): void {
  const output = {
    sources: result.sources.map((s) => ({
      type: s.type,
      name: s.name,
      path: s.path,
      exists: s.exists,
      serverCount: s.servers.length,
      error: s.error,
    })),
    summary: {
      total: result.allServers.length,
      http: result.httpServers.length,
      remote: result.remoteServers.length,
      stdio: result.stdioServers.length,
    },
    servers: result.allServers.map((s) => ({
      key: s.key,
      type: getServerType(s),
      source: s.source,
      url: s.url,
      command: s.command,
      args: s.args,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Main discover command handler.
 */
export async function discoverCommand(options: DiscoverOptions): Promise<void> {
  const config = loadConfig();
  const result = discoverAllConfigs();

  if (options.json) {
    printJson(result);
  } else {
    printResults(result, config.mcpProxyPort, options.verbose ?? false);
  }
}
