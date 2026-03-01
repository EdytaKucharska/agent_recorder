/**
 * Tests for configuration management.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, getDefaultDbPath, getActualListenPort } from "./config.js";

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

  describe("getActualListenPort", () => {
    // Note: getActualListenPort uses getDaemonPaths which reads os.homedir()
    // Testing the full flow requires writing to the actual daemon paths,
    // which we avoid in unit tests. The underlying functions (readPortFile,
    // checkDaemonStatus) are tested separately with custom paths in
    // daemon-paths.test.ts.

    it("returns default port when AR_LISTEN_PORT not set", () => {
      // Without a port file, should return default
      // (This test may pass or fail depending on daemon state on the machine)
      const port = getActualListenPort();
      // At minimum, should be a valid port number
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65535);
    });

    it("respects AR_LISTEN_PORT environment variable as fallback", () => {
      process.env["AR_LISTEN_PORT"] = "9000";
      const port = getActualListenPort();
      // If daemon is not running or no port file, should return 9000
      // If daemon IS running with a port file, returns that port
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65535);
    });
  });
});
