/**
 * Tests for lockfile handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  acquireLock,
  releaseLock,
  checkAndCleanStaleLock,
  acquireLockWithCleanup,
} from "./lockfile.js";

describe("lockfile", () => {
  let tempDir: string;
  let lockPath: string;
  let pidPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-lock-test-"));
    lockPath = path.join(tempDir, "test.lock");
    pidPath = path.join(tempDir, "test.pid");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("acquireLock", () => {
    it("acquires lock when file does not exist", () => {
      const result = acquireLock(lockPath);
      expect(result.acquired).toBe(true);
      expect(result.existingPid).toBeUndefined();
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    it("writes current PID to lock file", () => {
      acquireLock(lockPath);
      const content = fs.readFileSync(lockPath, "utf-8");
      expect(content).toBe(String(process.pid));
    });

    it("writes custom PID to lock file", () => {
      acquireLock(lockPath, 12345);
      const content = fs.readFileSync(lockPath, "utf-8");
      expect(content).toBe("12345");
    });

    it("fails when lock already exists", () => {
      acquireLock(lockPath, 11111);
      const result = acquireLock(lockPath, 22222);
      expect(result.acquired).toBe(false);
      expect(result.existingPid).toBe(11111);
    });

    it("creates parent directory if needed", () => {
      const nestedLock = path.join(tempDir, "nested", "dir", "test.lock");
      const result = acquireLock(nestedLock);
      expect(result.acquired).toBe(true);
      expect(fs.existsSync(nestedLock)).toBe(true);
    });
  });

  describe("releaseLock", () => {
    it("removes existing lock file", () => {
      acquireLock(lockPath);
      expect(fs.existsSync(lockPath)).toBe(true);
      releaseLock(lockPath);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("does not throw when lock does not exist", () => {
      expect(() => releaseLock(lockPath)).not.toThrow();
    });
  });

  describe("checkAndCleanStaleLock", () => {
    it("returns false when no lock exists", () => {
      expect(checkAndCleanStaleLock(lockPath)).toBe(false);
    });

    it("returns false for running process", () => {
      // Write lock with current process PID
      fs.writeFileSync(lockPath, String(process.pid));
      expect(checkAndCleanStaleLock(lockPath)).toBe(false);
      // Lock should still exist
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    it("returns true and cleans stale lock", () => {
      // Write lock with non-existent PID
      fs.writeFileSync(lockPath, "999999999");
      expect(checkAndCleanStaleLock(lockPath)).toBe(true);
      // Lock should be removed
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("cleans PID file along with lock", () => {
      fs.writeFileSync(lockPath, "999999999");
      fs.writeFileSync(pidPath, "999999999");
      expect(checkAndCleanStaleLock(lockPath, pidPath)).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it("cleans invalid PID content", () => {
      fs.writeFileSync(lockPath, "not-a-pid");
      expect(checkAndCleanStaleLock(lockPath)).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
    });
  });

  describe("acquireLockWithCleanup", () => {
    it("acquires lock when none exists", () => {
      const result = acquireLockWithCleanup(lockPath);
      expect(result.acquired).toBe(true);
    });

    it("cleans stale lock and acquires", () => {
      // Create stale lock
      fs.writeFileSync(lockPath, "999999999");

      const result = acquireLockWithCleanup(lockPath);
      expect(result.acquired).toBe(true);
      // Verify new lock has correct PID
      const content = fs.readFileSync(lockPath, "utf-8");
      expect(content).toBe(String(process.pid));
    });

    it("fails for active lock", () => {
      // Create lock with current process PID
      fs.writeFileSync(lockPath, String(process.pid));

      const result = acquireLockWithCleanup(lockPath, undefined, 99999);
      expect(result.acquired).toBe(false);
      expect(result.existingPid).toBe(process.pid);
    });

    it("cleans PID file with stale lock", () => {
      fs.writeFileSync(lockPath, "999999999");
      fs.writeFileSync(pidPath, "999999999");

      const result = acquireLockWithCleanup(lockPath, pidPath);
      expect(result.acquired).toBe(true);
      expect(fs.existsSync(pidPath)).toBe(false);
    });
  });

  describe("concurrent lock attempts", () => {
    it("only one acquire succeeds for multiple attempts", () => {
      const results = [
        acquireLock(lockPath, 1),
        acquireLock(lockPath, 2),
        acquireLock(lockPath, 3),
      ];

      const acquired = results.filter((r) => r.acquired);
      const failed = results.filter((r) => !r.acquired);

      expect(acquired).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });
  });
});
