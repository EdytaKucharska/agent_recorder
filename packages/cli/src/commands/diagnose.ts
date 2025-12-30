/**
 * Diagnose commands - focused diagnostic tools.
 */

import { loadConfig } from "@agent-recorder/core";

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolsListResult {
  tools: Array<{ name: string }>;
}

/**
 * Send a JSON-RPC request and get the response.
 */
async function sendJsonRpc(
  url: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<JsonRpcResponse | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as JsonRpcResponse;
  } catch {
    return null;
  }
}

/**
 * Categorize connection error.
 */
async function categorizeError(
  url: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return { ok: true };
  } catch (error) {
    const err = error as { cause?: { code?: string }; name?: string };
    if (err.name === "TimeoutError") {
      return { ok: false, error: "timeout" };
    }
    if (err.cause?.code === "ECONNREFUSED") {
      return { ok: false, error: "connection refused" };
    }
    if (err.cause?.code === "ENOTFOUND") {
      return { ok: false, error: "host not found" };
    }
    return { ok: false, error: "unreachable" };
  }
}

/**
 * Check if port accepts any connection.
 */
async function checkPortReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return false;
  }
}

export async function diagnoseMcpCommand(): Promise<void> {
  const config = loadConfig();
  const proxyUrl = `http://127.0.0.1:${config.mcpProxyPort}/`;

  console.log("MCP Diagnostics");
  console.log("===============");
  console.log("");

  let allPassed = true;

  // Check 1: Proxy listening
  const proxyReachable = await checkPortReachable(proxyUrl);
  if (proxyReachable) {
    console.log(`[\u2713] Proxy listening on :${config.mcpProxyPort}`);
  } else {
    console.log(`[\u2717] Proxy not listening on :${config.mcpProxyPort}`);
    console.log("    \u2192 Start daemon: agent-recorder start --daemon");
    allPassed = false;
  }

  // Check 2: Downstream configured
  if (!config.downstreamMcpUrl) {
    console.log("[\u2717] Downstream not configured");
    console.log("    \u2192 Set AR_DOWNSTREAM_MCP_URL environment variable");
    console.log("    \u2192 Or test with: agent-recorder mock-mcp --port 9999");
    allPassed = false;
  } else {
    console.log(`[\u2713] Downstream configured: ${config.downstreamMcpUrl}`);

    // Check 3: Downstream reachable
    const downstreamCheck = await categorizeError(config.downstreamMcpUrl);
    if (downstreamCheck.ok) {
      console.log("[\u2713] Downstream reachable");

      // Check 4: tools/list via proxy works
      if (proxyReachable) {
        const rpcResponse = await sendJsonRpc(proxyUrl, "tools/list");

        if (rpcResponse === null) {
          console.log("[\u2717] tools/list via proxy: failed to connect");
          allPassed = false;
        } else if (rpcResponse.error) {
          console.log(
            `[\u2717] tools/list via proxy: JSON-RPC error (${rpcResponse.error.code})`
          );
          console.log(`    Message: ${rpcResponse.error.message}`);
          allPassed = false;
        } else if (rpcResponse.result) {
          const result = rpcResponse.result as ToolsListResult;
          const toolCount = result.tools?.length ?? 0;
          console.log(`[\u2713] tools/list via proxy: ${toolCount} tools`);
        } else {
          console.log("[\u2717] tools/list via proxy: unexpected response");
          allPassed = false;
        }
      }
    } else {
      console.log(`[\u2717] Downstream reachable: ${downstreamCheck.error}`);
      console.log("    \u2192 Check if downstream MCP server is running");
      if (downstreamCheck.error === "connection refused") {
        console.log(
          "    \u2192 Test with: agent-recorder mock-mcp --port 9999"
        );
      }
      allPassed = false;
    }
  }

  console.log("");

  if (allPassed) {
    console.log("All checks passed.");
  } else {
    console.log("Some checks failed. See suggestions above.");
    process.exit(1);
  }
}
