/**
 * Stop command - stops a running daemon.
 */

import {
  getDaemonPaths,
  readPidFile,
  removePidFile,
  isProcessRunning,
  releaseLock,
} from "@agent-recorder/core";

export interface StopCommandOptions {
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

export async function stopCommand(
  options: StopCommandOptions = {}
): Promise<void> {
  const paths = getDaemonPaths();

  // Read PID file
  const pid = readPidFile();
  if (pid === null) {
    console.log("Daemon is not running (no PID file).");
    return;
  }

  // Check if process is running
  if (!isProcessRunning(pid)) {
    console.log(`Daemon is not running (stale PID ${pid}).`);
    // Clean up stale files
    removePidFile();
    releaseLock(paths.lockFile);
    console.log("Cleaned up stale files.");
    return;
  }

  // Send SIGTERM
  console.log(`Stopping daemon (PID ${pid})...`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === "ESRCH") {
      console.log("Process already exited.");
      removePidFile();
      releaseLock(paths.lockFile);
      return;
    }
    if (err.code === "EPERM") {
      console.error("Permission denied. Cannot stop the daemon.");
      process.exit(1);
    }
    throw error;
  }

  // Wait for process to exit (5 seconds)
  const exited = await waitForExit(pid, 5000);

  if (exited) {
    console.log("Daemon stopped successfully.");
    // Clean up (daemon should clean up on exit, but ensure cleanup)
    removePidFile();
    releaseLock(paths.lockFile);
    return;
  }

  // Process didn't exit in time
  if (options.force) {
    console.log("Process did not exit, sending SIGKILL...");
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process may have exited between check and kill
    }

    // Wait a bit more
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (!isProcessRunning(pid)) {
      console.log("Daemon killed.");
      removePidFile();
      releaseLock(paths.lockFile);
    } else {
      console.error("Failed to kill daemon.");
      process.exit(1);
    }
  } else {
    console.error(
      "Daemon did not stop within 5 seconds.\n" + "Use --force to send SIGKILL."
    );
    process.exit(1);
  }
}
