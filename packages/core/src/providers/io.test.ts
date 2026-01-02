/**
 * Tests for providers I/O utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import {
  getDefaultProvidersPath,
  readProvidersFile,
  writeProvidersFile,
  upsertProviders,
} from "./io.js";
import type { ProvidersFile, HttpProvider, StdioProvider } from "./types.js";

describe("Providers I/O", () => {
  const testDir = join(homedir(), ".agent-recorder-test");
  const testFilePath = join(testDir, "providers-test.json");

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("getDefaultProvidersPath", () => {
    it("returns path in user home directory", () => {
      const providersPath = getDefaultProvidersPath();
      const expected = join(homedir(), ".agent-recorder", "providers.json");
      expect(providersPath).toBe(expected);
    });
  });

  describe("readProvidersFile", () => {
    it("returns empty providers when file does not exist", () => {
      const result = readProvidersFile(testFilePath);
      expect(result).toEqual({
        version: 1,
        providers: [],
      });
    });

    it("returns empty providers when file is invalid JSON", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testFilePath, "invalid json", "utf-8");

      const result = readProvidersFile(testFilePath);
      expect(result).toEqual({
        version: 1,
        providers: [],
      });
    });

    it("returns empty providers when file has wrong version", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        testFilePath,
        JSON.stringify({ version: 2, providers: [] }),
        "utf-8"
      );

      const result = readProvidersFile(testFilePath);
      expect(result).toEqual({
        version: 1,
        providers: [],
      });
    });

    it("returns empty providers when providers is not an array", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        testFilePath,
        JSON.stringify({ version: 1, providers: "not-array" }),
        "utf-8"
      );

      const result = readProvidersFile(testFilePath);
      expect(result).toEqual({
        version: 1,
        providers: [],
      });
    });

    it("reads valid providers file", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "test-http",
            type: "http",
            url: "http://localhost:3000",
            headers: { Authorization: "Bearer token" },
          },
          {
            id: "test-stdio",
            type: "stdio",
            command: "npx",
            args: ["@playwright/mcp"],
            env: { NODE_ENV: "test" },
          },
        ],
      };

      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testFilePath, JSON.stringify(file), "utf-8");

      const result = readProvidersFile(testFilePath);
      expect(result).toEqual(file);
    });
  });

  describe("writeProvidersFile", () => {
    it("creates directory if it does not exist", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [],
      };

      writeProvidersFile(file, testFilePath);

      expect(fs.existsSync(testDir)).toBe(true);
      expect(fs.existsSync(testFilePath)).toBe(true);
    });

    it("writes pretty-printed JSON with 2-space indent", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "test",
            type: "http",
            url: "http://localhost:3000",
          },
        ],
      };

      writeProvidersFile(file, testFilePath);

      const content = fs.readFileSync(testFilePath, "utf-8");
      const expected = JSON.stringify(file, null, 2) + "\n";

      expect(content).toBe(expected);
    });

    it("writes and reads roundtrip correctly", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "http-provider",
            type: "http",
            url: "http://localhost:3000",
            headers: { "X-Custom": "value" },
          },
          {
            id: "stdio-provider",
            type: "stdio",
            command: "node",
            args: ["server.js", "--port", "8080"],
            env: { DEBUG: "1" },
          },
        ],
      };

      writeProvidersFile(file, testFilePath);
      const result = readProvidersFile(testFilePath);

      expect(result).toEqual(file);
    });
  });

  describe("upsertProviders", () => {
    it("adds new providers to empty file", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [],
      };

      const newProviders: HttpProvider[] = [
        {
          id: "new-provider",
          type: "http",
          url: "http://localhost:4000",
        },
      ];

      const result = upsertProviders(file, newProviders);

      expect(result.version).toBe(1);
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]).toEqual(newProviders[0]);
    });

    it("replaces existing provider with same id", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "test",
            type: "http",
            url: "http://localhost:3000",
          },
        ],
      };

      const updatedProviders: HttpProvider[] = [
        {
          id: "test",
          type: "http",
          url: "http://localhost:5000",
          headers: { "X-New": "header" },
        },
      ];

      const result = upsertProviders(file, updatedProviders);

      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]).toEqual(updatedProviders[0]);
      expect((result.providers[0] as HttpProvider).url).toBe(
        "http://localhost:5000"
      );
    });

    it("merges new and existing providers", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "existing",
            type: "http",
            url: "http://localhost:3000",
          },
        ],
      };

      const newProviders: StdioProvider[] = [
        {
          id: "new",
          type: "stdio",
          command: "npx",
          args: ["@playwright/mcp"],
        },
      ];

      const result = upsertProviders(file, newProviders);

      expect(result.providers).toHaveLength(2);
      expect(result.providers.find((p) => p.id === "existing")).toBeDefined();
      expect(result.providers.find((p) => p.id === "new")).toBeDefined();
    });

    it("handles multiple upserts correctly", () => {
      const file: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "provider-1",
            type: "http",
            url: "http://localhost:3000",
          },
        ],
      };

      const upsert1: HttpProvider[] = [
        {
          id: "provider-1",
          type: "http",
          url: "http://localhost:4000",
        },
        {
          id: "provider-2",
          type: "http",
          url: "http://localhost:5000",
        },
      ];

      const result1 = upsertProviders(file, upsert1);
      expect(result1.providers).toHaveLength(2);

      const upsert2: StdioProvider[] = [
        {
          id: "provider-3",
          type: "stdio",
          command: "node",
          args: ["server.js"],
        },
      ];

      const result2 = upsertProviders(result1, upsert2);
      expect(result2.providers).toHaveLength(3);
      expect(
        result2.providers.find((p) => p.id === "provider-1")
      ).toBeDefined();
      expect(
        result2.providers.find((p) => p.id === "provider-2")
      ).toBeDefined();
      expect(
        result2.providers.find((p) => p.id === "provider-3")
      ).toBeDefined();
    });
  });
});
