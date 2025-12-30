/**
 * Tests for Claude config detection module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  readJsonFile,
  writeJsonFileAtomic,
  createBackup,
  getMcpServerEntry,
  setMcpServerEntry,
  formatPath,
} from "./claude-paths.js";

describe("claude-paths", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-paths-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readJsonFile", () => {
    it("returns null for non-existent file", () => {
      const result = readJsonFile(path.join(tempDir, "nonexistent.json"));
      expect(result).toBeNull();
    });

    it("reads and parses valid JSON", () => {
      const filePath = path.join(tempDir, "test.json");
      fs.writeFileSync(filePath, '{"key": "value"}');

      const result = readJsonFile(filePath);
      expect(result).toEqual({ key: "value" });
    });

    it("returns null for invalid JSON", () => {
      const filePath = path.join(tempDir, "invalid.json");
      fs.writeFileSync(filePath, "not valid json");

      const result = readJsonFile(filePath);
      expect(result).toBeNull();
    });
  });

  describe("writeJsonFileAtomic", () => {
    it("writes JSON file with proper formatting", () => {
      const filePath = path.join(tempDir, "output.json");
      writeJsonFileAtomic(filePath, { key: "value", nested: { a: 1 } });

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain('"key": "value"');
      expect(content).toContain('"nested"');
      expect(content.endsWith("\n")).toBe(true);
    });

    it("creates parent directories if needed", () => {
      const filePath = path.join(tempDir, "nested", "deep", "config.json");
      writeJsonFileAtomic(filePath, { test: true });

      expect(fs.existsSync(filePath)).toBe(true);
      const result = readJsonFile(filePath);
      expect(result).toEqual({ test: true });
    });
  });

  describe("createBackup", () => {
    it("creates backup with timestamp", () => {
      const filePath = path.join(tempDir, "config.json");
      fs.writeFileSync(filePath, '{"original": true}');

      const backupPath = createBackup(filePath);

      expect(backupPath).toMatch(/config\.json\.bak-\d{14}$/);
      expect(fs.existsSync(backupPath)).toBe(true);

      const backupContent = fs.readFileSync(backupPath, "utf-8");
      expect(backupContent).toBe('{"original": true}');
    });

    it("returns path even if source doesn't exist", () => {
      const filePath = path.join(tempDir, "nonexistent.json");
      const backupPath = createBackup(filePath);

      expect(backupPath).toMatch(/\.bak-\d{14}$/);
      expect(fs.existsSync(backupPath)).toBe(false);
    });
  });

  describe("getMcpServerEntry", () => {
    it("returns null when mcpServers not present", () => {
      const config = { someOther: "config" };
      expect(getMcpServerEntry(config)).toBeNull();
    });

    it("returns null when agent-recorder entry not present", () => {
      const config = { mcpServers: { other: { url: "http://other" } } };
      expect(getMcpServerEntry(config)).toBeNull();
    });

    it("returns entry when present", () => {
      const config = {
        mcpServers: {
          "agent-recorder": { url: "http://127.0.0.1:8788/" },
        },
      };

      const entry = getMcpServerEntry(config);
      expect(entry).toEqual({ url: "http://127.0.0.1:8788/" });
    });

    it("returns entry with command config", () => {
      const config = {
        mcpServers: {
          "agent-recorder": {
            command: "node",
            args: ["server.js"],
          },
        },
      };

      const entry = getMcpServerEntry(config);
      expect(entry).toEqual({ command: "node", args: ["server.js"] });
    });
  });

  describe("setMcpServerEntry", () => {
    it("adds mcpServers when not present", () => {
      const config = { existing: "value" };
      const result = setMcpServerEntry(config, "http://127.0.0.1:8788/");

      expect(result).toEqual({
        existing: "value",
        mcpServers: {
          "agent-recorder": { url: "http://127.0.0.1:8788/" },
        },
      });
    });

    it("preserves existing mcpServers entries", () => {
      const config = {
        mcpServers: {
          other: { url: "http://other" },
        },
      };
      const result = setMcpServerEntry(config, "http://127.0.0.1:8788/");

      expect(result.mcpServers).toEqual({
        other: { url: "http://other" },
        "agent-recorder": { url: "http://127.0.0.1:8788/" },
      });
    });

    it("updates existing agent-recorder entry", () => {
      const config = {
        mcpServers: {
          "agent-recorder": { url: "http://old-url/" },
        },
      };
      const result = setMcpServerEntry(config, "http://127.0.0.1:8788/");

      expect(result.mcpServers).toEqual({
        "agent-recorder": { url: "http://127.0.0.1:8788/" },
      });
    });

    it("does not mutate original config", () => {
      const config = { existing: "value" };
      setMcpServerEntry(config, "http://127.0.0.1:8788/");

      expect(config).toEqual({ existing: "value" });
    });
  });

  describe("formatPath", () => {
    it("replaces home directory with ~", () => {
      const home = os.homedir();
      const result = formatPath(`${home}/some/path`);
      expect(result).toBe("~/some/path");
    });

    it("leaves other paths unchanged", () => {
      const result = formatPath("/usr/local/bin");
      expect(result).toBe("/usr/local/bin");
    });
  });
});
