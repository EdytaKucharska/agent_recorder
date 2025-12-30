/**
 * Start command - runs the daemon in foreground or background.
 */

import { existsSync, readFileSync, openSync, constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadConfig,
  getDaemonPaths,
  acquireLockWithCleanup,
  isProcessRunning,
  readPidFile,
} from "@agent-recorder/core";
import { startDaemon } from "@agent-recorder/service";

/**
 * Load environment variables from a file.
 * Parses KEY=VALUE lines, ignoring comments and empty lines.
 */
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    console.error(`Env file not found: ${filePath}`);
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Only set if not already defined (preserve existing env)
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function printStartupBanner(mcpProxyPort: number): void {
  console.log(`
Agent Recorder
==============

Claude Code v2 (recommended):
Add to ~/.claude/settings.json:

  {
    "mcpServers": {
      "agent-recorder": {
        "url": "http://127.0.0.1:${mcpProxyPort}/"
      }
    }
  }

Legacy clients (~/.config/claude/mcp.json):
Same JSON structure, different location.

Then restart Claude Code.
`);
}

export interface StartCommandOptions {
  envFile?: string;
  daemon?: boolean;
  force?: boolean;
}

/**
 * Send SIGTERM to a process and wait for it to exit.
 */
async function stopProcess(pid: number, timeoutMs = 5000): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already dead
    return true;
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!isProcessRunning(pid)) {
      return true;
    }
  }
  return false;
}

export async function startCommand(
  options: StartCommandOptions = {}
): Promise<void> {
  // Load env file before anything else if specified
  if (options.envFile) {
    loadEnvFile(options.envFile);
  }

  const config = loadConfig();
  const paths = getDaemonPaths();

  // Check for existing daemon
  const existingPid = readPidFile();
  if (existingPid && isProcessRunning(existingPid)) {
    if (options.force) {
      console.log(`Stopping existing daemon (PID ${existingPid})...`);
      const stopped = await stopProcess(existingPid);
      if (!stopped) {
        console.error(
          "Failed to stop existing daemon. Try: agent-recorder stop --force"
        );
        process.exit(1);
      }
      console.log("Existing daemon stopped.");
    } else {
      console.error(
        `Daemon is already running (PID ${existingPid}).\n` +
          "Use --force to restart, or run: agent-recorder stop"
      );
      process.exit(1);
    }
  }

  // Try to acquire lock
  const lockResult = acquireLockWithCleanup(paths.lockFile, paths.pidFile);
  if (!lockResult.acquired) {
    if (lockResult.existingPid) {
      console.error(
        `Another instance is running (PID ${lockResult.existingPid}).\n` +
          "Use --force to restart, or run: agent-recorder stop"
      );
    } else {
      console.error(`Failed to acquire lock: ${lockResult.error}`);
    }
    process.exit(1);
  }

  if (options.daemon) {
    // Daemon mode: fork and exit parent
    console.log("Starting daemon in background...");

    // Find the service entry point
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const serviceEntry = join(
      __dirname,
      "..",
      "..",
      "..",
      "service",
      "dist",
      "index.js"
    );

    // Open log file for daemon output
    const logFd = openSync(
      paths.logFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
    );

    // Build args for child process
    const args = [serviceEntry, "--daemon"];
    if (options.envFile) {
      args.push("--env-file", options.envFile);
    }

    // Spawn detached child process
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AR_DAEMON_MODE: "1",
      },
    });

    child.unref();

    // Wait for daemon to start (poll for PID file up to 5 seconds)
    let newPid: number | null = null;
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      newPid = readPidFile();
      if (newPid && isProcessRunning(newPid)) {
        break;
      }
    }

    // Check if daemon started successfully
    if (newPid && isProcessRunning(newPid)) {
      console.log(`Daemon started (PID ${newPid})`);
      console.log(`Log file: ${paths.logFile}`);
      console.log(`\nRun 'agent-recorder status' to check status.`);
    } else {
      console.error("Failed to start daemon. Check log file for details:");
      console.error(`  ${paths.logFile}`);
      process.exit(1);
    }
  } else {
    // Foreground mode: run directly
    printStartupBanner(config.mcpProxyPort);
    await startDaemon({ daemon: false });
  }
}
