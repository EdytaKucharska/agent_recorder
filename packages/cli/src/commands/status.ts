/**
 * Status command - comprehensive daemon status display.
 */

import {
  loadConfig,
  getActualListenPort,
  getDaemonPaths,
  readPidFile,
  isProcessRunning,
  readProvidersFile,
  getDefaultProvidersPath,
  type HttpProvider,
} from "@agent-recorder/core";

interface HealthResponse {
  status: string;
  pid: number;
  uptime: number;
  mode: "daemon" | "foreground";
  sessionId: string | null;
  startedAt: string | null;
}

/**
 * Format uptime in human-readable form.
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Check if a port is reachable via HTTP.
 * For MCP proxy, we accept any response (including 404/503) as "reachable".
 */
async function checkPort(
  port: number,
  path: string,
  acceptAnyResponse = false
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    // For REST API, require 2xx. For MCP proxy, any response means reachable.
    return acceptAnyResponse || response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a provider URL is reachable.
 */
async function checkProviderReachable(url: string): Promise<boolean> {
  try {
    // Send a minimal MCP initialize request to check connectivity
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "agent-recorder-status", version: "1.0" },
        },
      }),
      signal: AbortSignal.timeout(3000),
    });
    // Any response (even error) means the server is reachable
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function statusCommand(): Promise<void> {
  const config = loadConfig();
  const listenPort = getActualListenPort();
  const paths = getDaemonPaths();

  console.log("Agent Recorder Status");
  console.log("=====================");

  // Check PID file
  const pid = readPidFile();
  const processRunning = pid !== null && isProcessRunning(pid);

  if (!processRunning) {
    // Determine why not running
    if (pid === null) {
      console.log("State:        stopped");
      console.log("Reason:       No PID file found");
    } else {
      console.log("State:        stopped");
      console.log(`Reason:       Stale PID file (${pid} not running)`);
    }
    console.log("");
    console.log(`DB Path:      ${paths.dbFile}`);
    console.log("");
    console.log("Run 'agent-recorder start --daemon' to start.");
    process.exit(1);
  }

  // Process is running, try to get health info
  let health: HealthResponse | null = null;
  try {
    const response = await fetch(`http://127.0.0.1:${listenPort}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      health = (await response.json()) as HealthResponse;
    }
  } catch {
    // Health endpoint not reachable
  }

  // Check port availability
  const restApiReachable = await checkPort(listenPort, "/api/health");
  const mcpProxyReachable = await checkPort(config.mcpProxyPort, "/", true);

  // Display status
  console.log("State:        running");
  console.log(`Mode:         ${health?.mode ?? "unknown"}`);
  console.log(`PID:          ${pid}`);

  if (health?.uptime !== undefined) {
    console.log(`Uptime:       ${formatUptime(health.uptime)}`);
  }

  console.log(
    `REST API:     http://127.0.0.1:${listenPort} ${restApiReachable ? "(✓)" : "(✗)"}`
  );
  console.log(
    `MCP Proxy:    http://127.0.0.1:${config.mcpProxyPort} ${mcpProxyReachable ? "(✓)" : "(✗)"}`
  );

  if (health?.sessionId) {
    console.log(
      `Session:      active (id: ${health.sessionId.slice(0, 8)}...)`
    );
  } else {
    console.log("Session:      unknown");
  }

  console.log(`DB Path:      ${paths.dbFile}`);

  // Show provider health
  const providersFile = readProvidersFile(getDefaultProvidersPath());
  const httpProviders = providersFile.providers.filter(
    (p): p is HttpProvider => p.type === "http"
  );

  if (httpProviders.length > 0) {
    console.log("");
    console.log("Providers:");

    // Check all providers in parallel
    const results = await Promise.all(
      httpProviders.map(async (p) => ({
        id: p.id,
        url: p.url,
        reachable: await checkProviderReachable(p.url),
      }))
    );

    let reachableCount = 0;
    for (const result of results) {
      const icon = result.reachable ? "✓" : "✗";
      if (result.reachable) reachableCount++;
      console.log(`  ${icon} ${result.id}`);
    }

    if (reachableCount < results.length) {
      console.log("");
      console.log(
        `⚠ ${results.length - reachableCount}/${results.length} provider(s) unreachable`
      );
      console.log("  Run 'agent-recorder doctor' for details");
    }
  }

  // Show warnings
  if (!restApiReachable) {
    console.log("");
    console.log("⚠ REST API is not reachable. Check the log file:");
    console.log(`  ${paths.logFile}`);
  }
  if (!mcpProxyReachable) {
    console.log("");
    console.log("⚠ MCP Proxy is not reachable. Check the log file:");
    console.log(`  ${paths.logFile}`);
  }
}
