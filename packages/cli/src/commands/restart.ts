/**
 * Restart command - stops and starts the daemon.
 */

import {
  getDaemonPaths,
  readPidFile,
  removePidFile,
  isProcessRunning,
  releaseLock,
} from "@agent-recorder/core";
import { startCommand } from "./start.js";

export interface RestartCommandOptions {
  envFile?: string;
  force?: boolean;
}

/**
 * Wait for a process to exit.
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!isProcessRunning(pid)) {
      return true;
    }
  }
  return false;
}

export async function restartCommand(
  options: RestartCommandOptions = {}
): Promise<void> {
  const paths = getDaemonPaths();

  // Check if daemon is running
  const pid = readPidFile();

  if (pid !== null && isProcessRunning(pid)) {
    // Stop the running daemon
    console.log(`Stopping daemon (PID ${pid})...`);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have exited
    }

    // Wait for process to exit (5 seconds)
    const exited = await waitForExit(pid, 5000);

    if (!exited) {
      if (options.force) {
        console.log("Process did not exit, sending SIGKILL...");
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Process may have exited
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        console.error(
          "Daemon did not stop within 5 seconds.\n" +
            "Use --force to kill and restart."
        );
        process.exit(1);
      }
    }

    console.log("Daemon stopped.");
  } else if (pid !== null) {
    // Stale PID file
    console.log("Cleaning up stale files...");
  }

  // Clean up files
  removePidFile();
  releaseLock(paths.lockFile);

  // Start daemon in background
  console.log("Starting daemon...");
  await startCommand({
    daemon: true,
    ...(options.envFile ? { envFile: options.envFile } : {}),
  });
}
