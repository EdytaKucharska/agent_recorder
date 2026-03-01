/**
 * Daemon state file paths and PID management utilities.
 * Provides standard paths for PID file, lock file, and log file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface DaemonPaths {
  baseDir: string;
  pidFile: string;
  lockFile: string;
  logFile: string;
  dbFile: string;
  portFile: string;
}

/**
 * Get standard paths for daemon state files.
 * Base directory: ~/.agent-recorder/
 */
export function getDaemonPaths(): DaemonPaths {
  const baseDir = path.join(os.homedir(), ".agent-recorder");
  return {
    baseDir,
    pidFile: path.join(baseDir, "agent-recorder.pid"),
    lockFile: path.join(baseDir, "agent-recorder.lock"),
    logFile: path.join(baseDir, "agent-recorder.log"),
    dbFile: path.join(baseDir, "agent-recorder.sqlite"),
    portFile: path.join(baseDir, "agent-recorder.port"),
  };
}

/**
 * Write the actual bound port to a runtime port file.
 * CLI commands read this to find the daemon regardless of env config.
 */
export function writePortFile(port: number, portPath?: string): void {
  const { portFile } = getDaemonPaths();
  const filePath = portPath ?? portFile;
  const dir = path.dirname(filePath);

  // mkdirSync with recursive: true is idempotent - no need for existsSync
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, String(port), "utf-8");
}

/**
 * Read the port from the runtime port file.
 * Returns null if file doesn't exist or is invalid.
 */
export function readPortFile(portPath?: string): number | null {
  const { portFile } = getDaemonPaths();
  const filePath = portPath ?? portFile;

  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    const port = parseInt(content, 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      return null;
    }
    return port;
  } catch {
    return null;
  }
}

/**
 * Remove the runtime port file on daemon shutdown.
 */
export function removePortFile(portPath?: string): void {
  const { portFile } = getDaemonPaths();
  const filePath = portPath ?? portFile;

  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    // Only ignore ENOENT (file doesn't exist), rethrow other errors
    const error = err as { code?: string };
    if (error.code !== "ENOENT") {
      throw err;
    }
  }
}

/**
 * Read PID from PID file.
 * Returns null if file doesn't exist or is invalid.
 */
export function readPidFile(pidPath?: string): number | null {
  const { pidFile } = getDaemonPaths();
  const filePath = pidPath ?? pidFile;

  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    const pid = parseInt(content, 10);
    if (isNaN(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * Write PID to PID file.
 * Creates parent directory if needed.
 */
export function writePidFile(pid: number, pidPath?: string): void {
  const { pidFile } = getDaemonPaths();
  const filePath = pidPath ?? pidFile;
  const dir = path.dirname(filePath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, String(pid), "utf-8");
}

/**
 * Remove PID file if it exists.
 */
export function removePidFile(pidPath?: string): void {
  const { pidFile } = getDaemonPaths();
  const filePath = pidPath ?? pidFile;

  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if a process with the given PID is currently running.
 * Uses kill(pid, 0) which checks process existence without sending a signal.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 doesn't send a signal but checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH means process doesn't exist
    // EPERM means process exists but we don't have permission (still running)
    const err = error as { code?: string };
    return err.code === "EPERM";
  }
}

/**
 * Read PID from file and check if process is still running.
 * Returns { running: true, pid } if process is alive.
 * Returns { running: false, pid: null } if not running or no PID file.
 */
export function checkDaemonStatus(pidPath?: string): {
  running: boolean;
  pid: number | null;
} {
  const pid = readPidFile(pidPath);
  if (pid === null) {
    return { running: false, pid: null };
  }

  const running = isProcessRunning(pid);
  return { running, pid: running ? pid : null };
}

/**
 * Clean up stale PID file if the process is no longer running.
 * Returns true if cleanup was performed.
 */
export function cleanStalePidFile(pidPath?: string): boolean {
  const pid = readPidFile(pidPath);
  if (pid === null) {
    return false;
  }

  if (!isProcessRunning(pid)) {
    removePidFile(pidPath);
    return true;
  }

  return false;
}
