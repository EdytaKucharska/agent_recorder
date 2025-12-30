/**
 * Lockfile handling for single-instance daemon enforcement.
 * Uses exclusive file creation for atomic lock acquisition.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isProcessRunning, removePidFile } from "./daemon-paths.js";

export interface LockResult {
  acquired: boolean;
  existingPid?: number;
  error?: string;
}

/**
 * Attempt to acquire an exclusive lock.
 * Uses fs.openSync with 'wx' flag for atomic exclusive creation.
 *
 * @param lockPath - Path to lock file
 * @param pid - PID to write to lock file (defaults to current process)
 * @returns Result indicating success or failure with details
 */
export function acquireLock(lockPath: string, pid?: number): LockResult {
  const currentPid = pid ?? process.pid;
  const dir = path.dirname(lockPath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    // 'wx' flag: exclusive create, fails if file exists
    const fd = fs.openSync(lockPath, "wx");
    fs.writeSync(fd, String(currentPid));
    fs.closeSync(fd);
    return { acquired: true };
  } catch (error) {
    const err = error as { code?: string };

    if (err.code === "EEXIST") {
      // Lock file exists, read existing PID
      try {
        const content = fs.readFileSync(lockPath, "utf-8").trim();
        const existingPid = parseInt(content, 10);
        if (!isNaN(existingPid) && existingPid > 0) {
          return { acquired: false, existingPid };
        }
        return { acquired: false, error: "Invalid PID in lock file" };
      } catch {
        return { acquired: false, error: "Could not read lock file" };
      }
    }

    return {
      acquired: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Release a lock by removing the lock file.
 * Safe to call even if lock doesn't exist.
 */
export function releaseLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Ignore errors (file may not exist)
  }
}

/**
 * Check if lock is stale (process no longer running).
 * If stale, clean up the lock file and PID file.
 *
 * @param lockPath - Path to lock file
 * @param pidPath - Optional path to PID file (for cleanup)
 * @returns true if lock was stale and cleaned up
 */
export function checkAndCleanStaleLock(
  lockPath: string,
  pidPath?: string
): boolean {
  // Check if lock file exists
  if (!fs.existsSync(lockPath)) {
    return false;
  }

  // Read PID from lock file
  let existingPid: number;
  try {
    const content = fs.readFileSync(lockPath, "utf-8").trim();
    existingPid = parseInt(content, 10);
    if (isNaN(existingPid) || existingPid <= 0) {
      // Invalid PID, remove stale lock
      releaseLock(lockPath);
      if (pidPath) removePidFile(pidPath);
      return true;
    }
  } catch {
    // Can't read lock file, try to remove it
    releaseLock(lockPath);
    if (pidPath) removePidFile(pidPath);
    return true;
  }

  // Check if process is still running
  if (!isProcessRunning(existingPid)) {
    // Process is dead, clean up
    releaseLock(lockPath);
    if (pidPath) removePidFile(pidPath);
    return true;
  }

  // Process is still running, lock is valid
  return false;
}

/**
 * Try to acquire lock, cleaning up stale locks first.
 * This is the recommended way to acquire a lock.
 *
 * @param lockPath - Path to lock file
 * @param pidPath - Optional path to PID file (for stale cleanup)
 * @param pid - PID to write (defaults to current process)
 */
export function acquireLockWithCleanup(
  lockPath: string,
  pidPath?: string,
  pid?: number
): LockResult {
  // First, check and clean any stale lock
  checkAndCleanStaleLock(lockPath, pidPath);

  // Now try to acquire
  return acquireLock(lockPath, pid);
}
