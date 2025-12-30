/**
 * Doctor command - health check and configuration summary.
 */

import { loadConfig, type Session } from "@agent-recorder/core";

async function checkHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchSessions(baseUrl: string): Promise<Session[]> {
  try {
    const response = await fetch(`${baseUrl}/api/sessions`);
    if (!response.ok) return [];
    return (await response.json()) as Session[];
  } catch {
    return [];
  }
}

export async function doctorCommand(): Promise<void> {
  const config = loadConfig();
  const restBaseUrl = `http://127.0.0.1:${config.listenPort}`;
  const proxyBaseUrl = `http://127.0.0.1:${config.mcpProxyPort}`;

  console.log("Agent Recorder Doctor");
  console.log("=====================");
  console.log("");

  // Configuration
  console.log("Configuration:");
  console.log(`  REST API:     http://127.0.0.1:${config.listenPort}`);
  console.log(`  MCP Proxy:    http://127.0.0.1:${config.mcpProxyPort}`);
  console.log(`  Database:     ${config.dbPath}`);
  console.log(
    `  Downstream:   ${config.downstreamMcpUrl ?? "not configured"}`
  );
  console.log("");

  // Health checks
  console.log("Health:");
  const restHealthy = await checkHealth(`${restBaseUrl}/api/health`);
  const proxyHealthy = await checkHealth(`${proxyBaseUrl}/health`);

  if (restHealthy) {
    console.log("  \u2713 REST API responding");
  } else {
    console.log("  \u2717 REST API not responding");
  }

  if (proxyHealthy) {
    console.log("  \u2713 MCP Proxy responding");
  } else {
    console.log("  \u2717 MCP Proxy not responding");
  }
  console.log("");

  // Sessions summary
  console.log("Sessions:");
  if (restHealthy) {
    const sessions = await fetchSessions(restBaseUrl);
    const activeSessions = sessions.filter((s) => s.status === "active").length;
    console.log(`  Active: ${activeSessions}`);
    console.log(`  Total:  ${sessions.length}`);
  } else {
    console.log("  (unavailable - daemon not running)");
  }

  // Exit with error if not healthy
  if (!restHealthy || !proxyHealthy) {
    process.exit(1);
  }
}
