/**
 * Doctor command - comprehensive health check and configuration diagnostics.
 */

import {
  loadConfig,
  readPidFile,
  isProcessRunning,
  type Session,
} from "@agent-recorder/core";
import {
  detectClaudeConfig,
  readJsonFile,
  getMcpServerEntry,
  formatPath,
  getV2ConfigPath,
  getLegacyConfigPath,
} from "../config/claude-paths.js";

interface HealthResponse {
  status: string;
  pid: number;
  uptime: number;
  mode: "daemon" | "foreground";
  sessionId: string | null;
  startedAt: string | null;
}

interface LatestEventInfo {
  toolName: string | null;
  mcpMethod: string | null;
  startedAt: string;
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
 * Format time ago.
 */
function formatTimeAgo(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Check if a URL is reachable and optionally parse JSON response.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Check if a port is reachable (any response).
 */
async function checkPort(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Categorize connection error.
 */
async function categorizeError(url: string): Promise<string> {
  try {
    await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });
    return "ok";
  } catch (error) {
    const err = error as { cause?: { code?: string }; name?: string };
    if (err.name === "TimeoutError") {
      return "timeout";
    }
    if (err.cause?.code === "ECONNREFUSED") {
      return "connection refused";
    }
    if (err.cause?.code === "ENOTFOUND") {
      return "host not found";
    }
    return "unreachable";
  }
}

export async function doctorCommand(): Promise<void> {
  const config = loadConfig();
  const restBaseUrl = `http://127.0.0.1:${config.listenPort}`;
  const proxyBaseUrl = `http://127.0.0.1:${config.mcpProxyPort}`;

  const suggestions: string[] = [];
  let hasErrors = false;

  // === DAEMON STATUS ===
  console.log("Daemon");
  console.log("======");

  const pid = readPidFile();
  const processRunning = pid !== null && isProcessRunning(pid);

  if (!processRunning) {
    console.log("State:          stopped");
    if (pid === null) {
      console.log("Reason:         No PID file found");
    } else {
      console.log(`Reason:         Stale PID file (${pid} not running)`);
    }
    hasErrors = true;
    suggestions.push("Run: agent-recorder start --daemon");
    console.log("");
  } else {
    // Get health info
    const health = await fetchJson<HealthResponse>(`${restBaseUrl}/api/health`);

    console.log("State:          running");
    console.log(`PID:            ${pid}`);
    console.log(`Mode:           ${health?.mode ?? "unknown"}`);
    if (health?.uptime !== undefined) {
      console.log(`Uptime:         ${formatUptime(health.uptime)}`);
    }

    // Check REST API
    const restOk = health !== null;
    console.log(
      `REST API:       ${restBaseUrl} ${restOk ? "(\u2713)" : "(\u2717)"}`
    );
    if (!restOk) hasErrors = true;

    // Check MCP Proxy
    const proxyOk = await checkPort(`${proxyBaseUrl}/`);
    console.log(
      `MCP Proxy:      ${proxyBaseUrl} ${proxyOk ? "(\u2713)" : "(\u2717)"}`
    );
    if (!proxyOk) hasErrors = true;
    console.log("");
  }

  // === CONFIGURATION ===
  console.log("Configuration");
  console.log("=============");

  const claudeConfig = detectClaudeConfig();
  const expectedUrl = `http://127.0.0.1:${config.mcpProxyPort}/`;

  if (claudeConfig.kind === "none") {
    console.log("Claude Config:  not found");
    console.log(`                Checked: ${formatPath(getV2ConfigPath())}`);
    console.log(
      `                         ${formatPath(getLegacyConfigPath())}`
    );
    suggestions.push("Run: agent-recorder configure claude");
  } else {
    console.log(
      `Claude Config:  ${formatPath(claudeConfig.path!)} (${claudeConfig.kind})`
    );

    const configData = readJsonFile(claudeConfig.path!);
    if (configData === null) {
      console.log("MCP Entry:      error reading file");
      hasErrors = true;
    } else {
      const entry = getMcpServerEntry(configData);
      if (entry === null) {
        console.log("MCP Entry:      not present");
        suggestions.push("Run: agent-recorder configure claude");
      } else {
        console.log("MCP Entry:      present");
        if (entry.url) {
          const matches = entry.url === expectedUrl;
          const symbol = matches
            ? "\u2713 matches"
            : `\u2717 expected ${expectedUrl}`;
          console.log(`URL:            ${entry.url} (${symbol})`);
          if (!matches) {
            suggestions.push("Run: agent-recorder configure claude");
          }
        } else if (entry.command) {
          console.log(`Command:        ${entry.command} (stdio mode)`);
        }
      }
    }
  }
  console.log("");

  // === DOWNSTREAM MCP ===
  console.log("Downstream MCP");
  console.log("==============");

  if (!config.downstreamMcpUrl) {
    console.log("Configured:     not set");
    console.log("                (proxy will return 503 for MCP requests)");
    suggestions.push("Set AR_DOWNSTREAM_MCP_URL environment variable");
    suggestions.push("Or test with: agent-recorder mock-mcp --port 9999");
  } else {
    console.log(`Configured:     ${config.downstreamMcpUrl}`);

    const errorType = await categorizeError(config.downstreamMcpUrl);
    if (errorType === "ok") {
      console.log("Reachable:      \u2713");
    } else {
      console.log(`Reachable:      \u2717 (${errorType})`);
      hasErrors = true;
      if (errorType === "connection refused") {
        suggestions.push("Check if downstream MCP server is running");
      }
    }
  }
  console.log("");

  // === RECORDING HEALTH ===
  console.log("Recording");
  console.log("=========");

  if (processRunning) {
    // Get current session
    const currentSession = await fetchJson<Session>(
      `${restBaseUrl}/api/sessions/current`
    );

    if (currentSession) {
      console.log(
        `Session:        ${currentSession.id.slice(0, 12)}... (${currentSession.status})`
      );

      // Get event count
      const countResponse = await fetchJson<{ count: number }>(
        `${restBaseUrl}/api/sessions/${currentSession.id}/events/count`
      );
      if (countResponse) {
        console.log(`Events:         ${countResponse.count}`);
      }

      // Get latest tool_call
      const latestEvent = await fetchJson<LatestEventInfo>(
        `${restBaseUrl}/api/sessions/${currentSession.id}/events/latest-tool-call`
      );

      if (latestEvent) {
        const name = latestEvent.mcpMethod || latestEvent.toolName || "unknown";
        console.log(
          `Last tool_call: ${formatTimeAgo(latestEvent.startedAt)} (${name})`
        );
      } else {
        console.log("Last tool_call: none recorded");
      }
    } else {
      console.log("Session:        none active");
    }
  } else {
    console.log("Session:        (daemon not running)");
  }
  console.log("");

  // === SUGGESTED ACTIONS ===
  if (suggestions.length > 0) {
    console.log("Suggested Actions");
    console.log("=================");
    for (const suggestion of suggestions) {
      console.log(`\u2192 ${suggestion}`);
    }
    if (claudeConfig.kind !== "none") {
      console.log("\u2192 Restart Claude Code to apply config changes");
    }
    console.log("");
  }

  // Exit with error code if issues found
  if (hasErrors) {
    process.exit(1);
  }
}
