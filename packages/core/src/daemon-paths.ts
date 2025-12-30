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
  };
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
