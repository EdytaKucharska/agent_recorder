#!/usr/bin/env node
/* global console, process, fetch, AbortSignal, setTimeout */
/**
 * End-to-end smoke test for Hubify milestone.
 *
 * This script:
 * 1. Creates temp HOME with mock Claude config (2 providers)
 * 2. Runs agent-recorder install (hubify mode)
 * 3. Starts 2 mock MCP servers
 * 4. Starts agent-recorder daemon
 * 5. Calls tools/list and tools/call through hub
 * 6. Verifies events recorded in SQLite
 * 7. Cleans up
 */

import { execSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// Colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function log(msg) {
  console.log(`${colors.blue}→${colors.reset} ${msg}`);
}

function success(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function error(msg) {
  console.error(`${colors.red}✗${colors.reset} ${msg}`);
}

function warn(msg) {
  console.log(`${colors.yellow}!${colors.reset} ${msg}`);
}

/**
 * Run command with HOME override.
 */
function run(cmd, env = {}) {
  log(cmd);
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: "pipe",
    });
    return output;
  } catch (err) {
    error(`Command failed: ${cmd}`);
    console.error(err.stdout);
    console.error(err.stderr);
    throw err;
  }
}

/**
 * Start a background process.
 */
function startBackground(cmd, args, env = {}) {
  log(`${cmd} ${args.join(" ")} (background)`);
  const proc = spawn(cmd, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: "pipe",
  });

  proc.stdout.on("data", (data) => {
    // Suppress output unless debugging
    if (process.env.DEBUG) {
      console.log(data.toString());
    }
  });

  proc.stderr.on("data", (data) => {
    if (process.env.DEBUG) {
      console.error(data.toString());
    }
  });

  return proc;
}

/**
 * Wait for a port to be listening (REST API).
 */
async function waitForPort(port, timeoutMs = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Port not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Port ${port} did not become available within ${timeoutMs}ms`
  );
}

/**
 * Wait for MCP proxy port to be listening.
 */
async function waitForMcpPort(port, timeoutMs = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Port not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `MCP proxy port ${port} did not become available within ${timeoutMs}ms`
  );
}

/**
 * Create a minimal mock MCP server.
 */
function createMockServer(port, toolName) {
  return `
import * as http from 'node:http';

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const request = JSON.parse(body);
    let response;

    if (request.method === 'tools/list') {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [{
            name: '${toolName}',
            description: 'Test tool for ${toolName}',
            inputSchema: { type: 'object', properties: {} }
          }]
        }
      };
    } else if (request.method === 'tools/call') {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        result: { content: [{ type: 'text', text: 'ok' }] }
      };
    } else {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Method not found' }
      };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
});

server.listen(${port}, '127.0.0.1');
console.log('Mock server ready on port ${port}');
`;
}

/**
 * Main smoke test.
 */
async function smokeTest() {
  console.log("\n=== Hubify Smoke Test ===\n");

  // Step 1: Create temp HOME
  log("Creating temp HOME directory...");
  const tempHome = mkdtempSync(join(tmpdir(), "ar-hubify-test-"));
  success(`Created: ${tempHome}`);

  const mockProcs = [];

  try {
    // Step 2: Create Claude config with 2 mock providers
    log("Creating mock Claude config...");
    const claudeDir = join(tempHome, ".claude");
    mkdirSync(claudeDir, { recursive: true });

    const claudeConfig = {
      mcpServers: {
        github: {
          url: "http://127.0.0.1:19001/",
        },
        playwright: {
          url: "http://127.0.0.1:19002/",
        },
      },
    };

    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify(claudeConfig, null, 2)
    );
    success("Created Claude config with 2 providers");

    // Step 3: Update .env to use non-conflicting ports
    log("Configuring ports for smoke test...");
    const dataDir = join(tempHome, ".agent-recorder");
    mkdirSync(dataDir, { recursive: true });

    const envContent = `# Smoke test configuration
AR_LISTEN_PORT=18787
AR_MCP_PROXY_PORT=18788
`;
    writeFileSync(join(dataDir, ".env"), envContent);
    success("Configured test ports (18787, 18788)");

    // Step 4: Run agent-recorder install
    log("Running agent-recorder install...");
    const binPath = join(rootDir, "packages", "cli", "dist", "index.js");
    run(`node "${binPath}" install`, {
      HOME: tempHome,
      AR_LISTEN_PORT: "18787",
      AR_MCP_PROXY_PORT: "18788",
    });
    success("Install completed");

    // Verify providers.json was created
    const providersPath = join(tempHome, ".agent-recorder", "providers.json");
    if (!existsSync(providersPath)) {
      throw new Error("providers.json was not created");
    }
    const providers = JSON.parse(readFileSync(providersPath, "utf-8"));
    if (providers.providers.length !== 2) {
      throw new Error(
        `Expected 2 providers, got ${providers.providers.length}`
      );
    }
    success("Verified providers.json created with 2 providers");

    // Verify Claude config was hubified to point to correct port
    const claudeConfigAfter = JSON.parse(
      readFileSync(join(claudeDir, "settings.json"), "utf-8")
    );
    const agentRecorderUrl =
      claudeConfigAfter.mcpServers?.["agent-recorder"]?.url;
    if (agentRecorderUrl !== "http://127.0.0.1:18788/") {
      throw new Error(
        `Expected agent-recorder URL to be http://127.0.0.1:18788/, got ${agentRecorderUrl}`
      );
    }
    success("Claude config hubified to use test port 18788");

    // Step 4: Start mock MCP servers
    log("Starting mock MCP servers...");

    // Write mock server scripts
    const mockServer1Path = join(tempHome, "mock-server-1.mjs");
    const mockServer2Path = join(tempHome, "mock-server-2.mjs");

    writeFileSync(mockServer1Path, createMockServer(19001, "get_file"));
    writeFileSync(mockServer2Path, createMockServer(19002, "browser_action"));

    // Start servers
    const mock1 = startBackground("node", [mockServer1Path], {
      HOME: tempHome,
    });
    const mock2 = startBackground("node", [mockServer2Path], {
      HOME: tempHome,
    });

    mockProcs.push(mock1, mock2);

    // Wait for servers to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
    success("Mock MCP servers started");

    // Step 5: Start daemon
    log("Starting agent-recorder daemon...");

    // Use execSync to start daemon in background
    const envFile = join(dataDir, ".env");
    try {
      run(`node "${binPath}" start --daemon --env-file "${envFile}"`, {
        HOME: tempHome,
      });
    } catch (err) {
      // Read log file to see what went wrong
      const logPath = join(tempHome, ".agent-recorder", "agent-recorder.log");
      if (existsSync(logPath)) {
        const logContents = readFileSync(logPath, "utf-8");
        error("Daemon startup failed. Log contents:");
        console.error(logContents);
      }
      throw err;
    }

    // Wait for daemon to be ready (give it more time since it's starting in background)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      await waitForPort(18787, 15000); // REST API port
      await waitForMcpPort(18788, 15000); // MCP proxy port
      success("Daemon started and ready");
    } catch (err) {
      // Print log file if port wait fails
      const logPath = join(tempHome, ".agent-recorder", "agent-recorder.log");
      if (existsSync(logPath)) {
        error("Port wait failed. Daemon log:");
        console.error(readFileSync(logPath, "utf-8"));
      }
      throw err;
    }

    // Step 6: Call tools/list through hub
    log("Testing hub tools/list...");
    const toolsListResponse = await fetch("http://127.0.0.1:18788/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }),
    });

    if (!toolsListResponse.ok) {
      throw new Error(
        `tools/list failed with status ${toolsListResponse.status}`
      );
    }

    const toolsList = await toolsListResponse.json();
    const tools = toolsList.result.tools;

    if (tools.length !== 2) {
      throw new Error(`Expected 2 tools, got ${tools.length}`);
    }

    const toolNames = tools.map((t) => t.name).sort();
    if (
      toolNames[0] !== "github.get_file" ||
      toolNames[1] !== "playwright.browser_action"
    ) {
      throw new Error(
        `Tool names don't match expected: ${JSON.stringify(toolNames)}`
      );
    }

    success("tools/list returned 2 namespaced tools");

    // Step 7: Call tools/call through hub
    log("Testing hub tools/call...");
    const toolsCallResponse = await fetch("http://127.0.0.1:18788/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "github.get_file",
          arguments: { path: "/test" },
        },
        id: 2,
      }),
    });

    if (!toolsCallResponse.ok) {
      throw new Error(
        `tools/call failed with status ${toolsCallResponse.status}`
      );
    }

    const toolsCallResult = await toolsCallResponse.json();
    if (toolsCallResult.error) {
      throw new Error(
        `tools/call returned error: ${toolsCallResult.error.message}`
      );
    }

    success("tools/call succeeded");

    // Step 8: Verify events via REST API
    log("Verifying events via REST API...");

    // Get current session
    const sessionResponse = await fetch(
      "http://127.0.0.1:18787/api/sessions/current"
    );
    if (!sessionResponse.ok) {
      throw new Error("Failed to get current session");
    }

    const session = await sessionResponse.json();
    if (!session.id) {
      throw new Error("No active session found");
    }

    // Get events for this session
    const eventsResponse = await fetch(
      `http://127.0.0.1:18787/api/sessions/${session.id}/events`
    );
    if (!eventsResponse.ok) {
      throw new Error("Failed to get session events");
    }

    const events = await eventsResponse.json();
    const toolCallEvents = events.filter((e) => e.eventType === "tool_call");

    if (toolCallEvents.length === 0) {
      throw new Error("No tool_call events recorded");
    }

    // Verify the event we called
    const githubEvent = toolCallEvents.find((e) => e.upstreamKey === "github");
    if (!githubEvent) {
      throw new Error("github tool_call event not found");
    }

    if (githubEvent.toolName !== "get_file") {
      throw new Error(
        `Expected toolName 'get_file', got '${githubEvent.toolName}'`
      );
    }

    if (githubEvent.status !== "success") {
      throw new Error(`Expected status 'success', got '${githubEvent.status}'`);
    }

    success(`Verified ${toolCallEvents.length} tool_call event(s) recorded`);
    success("Event has correct upstreamKey and toolName");

    console.log("\n=== HUBIFY SMOKE TEST PASSED ===\n");
  } catch (err) {
    error("Smoke test failed");
    console.error(err);

    // Cleanup on error
    mockProcs.forEach((proc) => {
      try {
        proc.kill();
      } catch {
        // Ignore kill errors
      }
    });

    // Try to stop daemon before cleanup
    try {
      const binPath = join(rootDir, "packages", "cli", "dist", "index.js");
      run(`node "${binPath}" stop`, { HOME: tempHome });
    } catch {
      // Ignore stop errors
    }

    rmSync(tempHome, { recursive: true, force: true });
    process.exit(1);
  } finally {
    // Step 9: Cleanup
    log("Cleaning up...");

    // Stop daemon
    try {
      const binPath = join(rootDir, "packages", "cli", "dist", "index.js");
      run(`node "${binPath}" stop`, { HOME: tempHome });
      success("Daemon stopped");
    } catch {
      warn("Failed to stop daemon gracefully");
    }

    // Stop mock servers
    mockProcs.forEach((proc) => {
      try {
        proc.kill();
      } catch {
        // Ignore kill errors
      }
    });
    success("Mock servers stopped");

    // Remove temp directory
    rmSync(tempHome, { recursive: true, force: true });
    success("Temp directory removed");
  }
}

smokeTest().catch((error) => {
  console.error("\n=== SMOKE TEST FAILED ===");
  console.error(error);
  process.exit(1);
});
