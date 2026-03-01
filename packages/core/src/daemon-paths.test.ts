/**
 * Tests for daemon paths and PID file utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getDaemonPaths,
  readPidFile,
  writePidFile,
  removePidFile,
  writePortFile,
  readPortFile,
  removePortFile,
  isProcessRunning,
  checkDaemonStatus,
  cleanStalePidFile,
} from "./daemon-paths.js";

describe("getDaemonPaths", () => {
  it("returns paths in home directory", () => {
    const paths = getDaemonPaths();
    const home = os.homedir();

    expect(paths.baseDir).toBe(path.join(home, ".agent-recorder"));
    expect(paths.pidFile).toBe(
      path.join(home, ".agent-recorder", "agent-recorder.pid")
    );
    expect(paths.lockFile).toBe(
      path.join(home, ".agent-recorder", "agent-recorder.lock")
    );
    expect(paths.logFile).toBe(
      path.join(home, ".agent-recorder", "agent-recorder.log")
    );
    expect(paths.dbFile).toBe(
      path.join(home, ".agent-recorder", "agent-recorder.sqlite")
    );
    expect(paths.portFile).toBe(
      path.join(home, ".agent-recorder", "agent-recorder.port")
    );
  });
});

describe("PID file operations", () => {
  let tempDir: string;
  let pidFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-test-"));
    pidFilePath = path.join(tempDir, "test.pid");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readPidFile", () => {
    it("returns null when file does not exist", () => {
      expect(readPidFile(pidFilePath)).toBeNull();
    });

    it("returns null for empty file", () => {
      fs.writeFileSync(pidFilePath, "");
      expect(readPidFile(pidFilePath)).toBeNull();
    });

    it("returns null for non-numeric content", () => {
      fs.writeFileSync(pidFilePath, "not-a-number");
      expect(readPidFile(pidFilePath)).toBeNull();
    });

    it("returns null for negative numbers", () => {
      fs.writeFileSync(pidFilePath, "-123");
      expect(readPidFile(pidFilePath)).toBeNull();
    });

    it("returns PID for valid content", () => {
      fs.writeFileSync(pidFilePath, "12345");
      expect(readPidFile(pidFilePath)).toBe(12345);
    });

    it("trims whitespace", () => {
      fs.writeFileSync(pidFilePath, "  12345  \n");
      expect(readPidFile(pidFilePath)).toBe(12345);
    });
  });

  describe("writePidFile", () => {
    it("writes PID to file", () => {
      writePidFile(12345, pidFilePath);
      expect(fs.readFileSync(pidFilePath, "utf-8")).toBe("12345");
    });

    it("creates parent directory if needed", () => {
      const nestedPath = path.join(tempDir, "nested", "dir", "test.pid");
      writePidFile(12345, nestedPath);
      expect(fs.readFileSync(nestedPath, "utf-8")).toBe("12345");
    });

    it("overwrites existing file", () => {
      writePidFile(11111, pidFilePath);
      writePidFile(22222, pidFilePath);
      expect(fs.readFileSync(pidFilePath, "utf-8")).toBe("22222");
    });
  });

  describe("removePidFile", () => {
    it("removes existing file", () => {
      fs.writeFileSync(pidFilePath, "12345");
      removePidFile(pidFilePath);
      expect(fs.existsSync(pidFilePath)).toBe(false);
    });

    it("does not throw when file does not exist", () => {
      expect(() => removePidFile(pidFilePath)).not.toThrow();
    });
  });
});

describe("Port file operations", () => {
  let tempDir: string;
  let portFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-port-test-"));
    portFilePath = path.join(tempDir, "test.port");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readPortFile", () => {
    it("returns null when file does not exist", () => {
      expect(readPortFile(portFilePath)).toBeNull();
    });

    it("returns null for empty file", () => {
      fs.writeFileSync(portFilePath, "");
      expect(readPortFile(portFilePath)).toBeNull();
    });

    it("returns null for non-numeric content", () => {
      fs.writeFileSync(portFilePath, "not-a-number");
      expect(readPortFile(portFilePath)).toBeNull();
    });

    it("returns null for negative numbers", () => {
      fs.writeFileSync(portFilePath, "-123");
      expect(readPortFile(portFilePath)).toBeNull();
    });

    it("returns null for port > 65535", () => {
      fs.writeFileSync(portFilePath, "70000");
      expect(readPortFile(portFilePath)).toBeNull();
    });

    it("returns null for port 0", () => {
      fs.writeFileSync(portFilePath, "0");
      expect(readPortFile(portFilePath)).toBeNull();
    });

    it("returns port for valid content", () => {
      fs.writeFileSync(portFilePath, "8787");
      expect(readPortFile(portFilePath)).toBe(8787);
    });

    it("returns port for boundary value 65535", () => {
      fs.writeFileSync(portFilePath, "65535");
      expect(readPortFile(portFilePath)).toBe(65535);
    });

    it("trims whitespace", () => {
      fs.writeFileSync(portFilePath, "  8787  \n");
      expect(readPortFile(portFilePath)).toBe(8787);
    });
  });

  describe("writePortFile", () => {
    it("writes port to file", () => {
      writePortFile(8787, portFilePath);
      expect(fs.readFileSync(portFilePath, "utf-8")).toBe("8787");
    });

    it("creates parent directory if needed", () => {
      const nestedPath = path.join(tempDir, "nested", "dir", "test.port");
      writePortFile(8787, nestedPath);
      expect(fs.readFileSync(nestedPath, "utf-8")).toBe("8787");
    });

    it("overwrites existing file", () => {
      writePortFile(8787, portFilePath);
      writePortFile(8788, portFilePath);
      expect(fs.readFileSync(portFilePath, "utf-8")).toBe("8788");
    });

    it("is idempotent with existing directory", () => {
      // First write creates directory
      writePortFile(8787, portFilePath);
      // Second write should not fail
      expect(() => writePortFile(8788, portFilePath)).not.toThrow();
      expect(fs.readFileSync(portFilePath, "utf-8")).toBe("8788");
    });
  });

  describe("removePortFile", () => {
    it("removes existing file", () => {
      fs.writeFileSync(portFilePath, "8787");
      removePortFile(portFilePath);
      expect(fs.existsSync(portFilePath)).toBe(false);
    });

    it("does not throw when file does not exist", () => {
      expect(() => removePortFile(portFilePath)).not.toThrow();
    });
  });
});

describe("isProcessRunning", () => {
  it("returns true for current process", () => {
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  it("returns false for non-existent PID", () => {
    // Use a very high PID that's unlikely to exist
    expect(isProcessRunning(999999999)).toBe(false);
  });
});

describe("checkDaemonStatus", () => {
  let tempDir: string;
  let pidFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-test-"));
    pidFilePath = path.join(tempDir, "test.pid");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns not running when no PID file", () => {
    const status = checkDaemonStatus(pidFilePath);
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
  });

  it("returns running for current process PID", () => {
    fs.writeFileSync(pidFilePath, String(process.pid));
    const status = checkDaemonStatus(pidFilePath);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
  });

  it("returns not running for stale PID", () => {
    fs.writeFileSync(pidFilePath, "999999999");
    const status = checkDaemonStatus(pidFilePath);
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
  });
});

describe("cleanStalePidFile", () => {
  let tempDir: string;
  let pidFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-test-"));
    pidFilePath = path.join(tempDir, "test.pid");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false when no PID file", () => {
    expect(cleanStalePidFile(pidFilePath)).toBe(false);
  });

  it("returns false and does not remove for running process", () => {
    fs.writeFileSync(pidFilePath, String(process.pid));
    expect(cleanStalePidFile(pidFilePath)).toBe(false);
    expect(fs.existsSync(pidFilePath)).toBe(true);
  });

  it("returns true and removes stale PID file", () => {
    fs.writeFileSync(pidFilePath, "999999999");
    expect(cleanStalePidFile(pidFilePath)).toBe(true);
    expect(fs.existsSync(pidFilePath)).toBe(false);
  });
});
