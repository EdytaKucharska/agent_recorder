/**
 * MCP server CLI commands.
 *
 * The MCP server is mounted on the existing daemon at /mcp.
 * These commands provide status and stdio access.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getActualListenPort } from "@agent-recorder/core";

function getMcpUrl(): string {
  const port = getActualListenPort();
  return `http://127.0.0.1:${port}/mcp`;
}

async function isDaemonRunning(): Promise<boolean> {
  try {
    const port = getActualListenPort();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Print the MCP endpoint URL if the daemon is running.
 */
export async function mcpServerStartCommand(): Promise<void> {
  if (await isDaemonRunning()) {
    const url = getMcpUrl();
    console.log(`MCP server available at: ${url}`);
    console.log(`Add to Claude Code MCP settings:\n  URL: ${url}`);
  } else {
    console.error("Agent Recorder daemon is not running.");
    console.error("Start it first: agent-recorder start");
    process.exit(1);
  }
}

/**
 * Ping the /mcp endpoint to check if it responds.
 */
export async function mcpServerStatusCommand(): Promise<void> {
  if (!(await isDaemonRunning())) {
    console.log("MCP server: not running (daemon is not running)");
    console.log("Start with: agent-recorder start");
    return;
  }

  const url = getMcpUrl();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "ar-cli", version: "1" },
        },
      }),
    });
    if (res.ok || res.status === 200) {
      console.log(`MCP server: running at ${url}`);
    } else {
      console.log(`MCP server: responded with HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(
      `MCP server: not responding (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * Run the MCP server in STDIO mode by spawning the stdio entry point.
 * Pipes stdin/stdout through. Used for direct Claude Code MCP integration.
 */
export async function mcpServerStdioCommand(): Promise<void> {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const stdioPath = join(
    thisDir,
    "..",
    "..",
    "..",
    "mcp-server",
    "dist",
    "stdio.js"
  );

  try {
    execFileSync(process.execPath, [stdioPath], {
      stdio: "inherit",
      env: process.env,
    });
  } catch (err) {
    // Non-zero exit — propagate exit code if available
    if (
      err !== null &&
      typeof err === "object" &&
      "status" in err &&
      typeof err.status === "number"
    ) {
      process.exit(err.status);
    }
    console.error(
      `[mcp-server] Failed to start STDIO server: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
