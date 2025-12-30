/**
 * Tests for configuration management.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, getDefaultDbPath } from "./config.js";

describe("Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env["AR_DB_PATH"];
    delete process.env["AR_DEBUG_PROXY"];
    delete process.env["AR_LISTEN_PORT"];
    delete process.env["AR_MCP_PROXY_PORT"];
    delete process.env["AR_DOWNSTREAM_MCP_URL"];
    delete process.env["AR_REDACT_KEYS"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getDefaultDbPath", () => {
    it("returns path in user home directory", () => {
      const dbPath = getDefaultDbPath();
      const expected = join(
        homedir(),
        ".agent-recorder",
        "agent-recorder.sqlite"
      );
      expect(dbPath).toBe(expected);
    });
  });

  describe("loadConfig", () => {
    it("uses default DB path in home directory when AR_DB_PATH not set", () => {
      const config = loadConfig();
      const expected = join(
        homedir(),
        ".agent-recorder",
        "agent-recorder.sqlite"
      );
      expect(config.dbPath).toBe(expected);
    });

    it("uses AR_DB_PATH when set", () => {
      process.env["AR_DB_PATH"] = "/custom/path/db.sqlite";
      const config = loadConfig();
      expect(config.dbPath).toBe("/custom/path/db.sqlite");
    });

    it("sets debugProxy to false by default", () => {
      const config = loadConfig();
      expect(config.debugProxy).toBe(false);
    });

    it("sets debugProxy to true when AR_DEBUG_PROXY=1", () => {
      process.env["AR_DEBUG_PROXY"] = "1";
      const config = loadConfig();
      expect(config.debugProxy).toBe(true);
    });

    it("sets debugProxy to false for other AR_DEBUG_PROXY values", () => {
      process.env["AR_DEBUG_PROXY"] = "true";
      const config = loadConfig();
      expect(config.debugProxy).toBe(false);
    });

    it("uses default ports when not set", () => {
      const config = loadConfig();
      expect(config.listenPort).toBe(8787);
      expect(config.mcpProxyPort).toBe(8788);
    });

    it("uses custom ports when set", () => {
      process.env["AR_LISTEN_PORT"] = "9000";
      process.env["AR_MCP_PROXY_PORT"] = "9001";
      const config = loadConfig();
      expect(config.listenPort).toBe(9000);
      expect(config.mcpProxyPort).toBe(9001);
    });

    it("sets downstreamMcpUrl to null when not set", () => {
      const config = loadConfig();
      expect(config.downstreamMcpUrl).toBeNull();
    });

    it("uses AR_DOWNSTREAM_MCP_URL when set", () => {
      process.env["AR_DOWNSTREAM_MCP_URL"] = "http://localhost:9999";
      const config = loadConfig();
      expect(config.downstreamMcpUrl).toBe("http://localhost:9999");
    });
  });
});
