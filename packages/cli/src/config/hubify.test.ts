/**
 * Tests for hubify transformation logic.
 */

import { describe, it, expect } from "vitest";
import {
  extractProviders,
  hubifyClaudeConfig,
  mergeProviders,
} from "./hubify.js";
import type {
  Provider,
  ProvidersFile,
  HttpProvider,
} from "@agent-recorder/core";

describe("Hubify", () => {
  describe("extractProviders", () => {
    it("extracts HTTP providers correctly", () => {
      const mcpServers = {
        github: {
          url: "https://api.github.com/mcp",
          headers: { Authorization: "Bearer token" },
        },
        local: {
          url: "http://localhost:3000",
        },
      };

      const providers = extractProviders(mcpServers);

      expect(providers).toHaveLength(2);
      expect(providers[0]).toEqual({
        id: "github",
        type: "http",
        url: "https://api.github.com/mcp",
        headers: { Authorization: "Bearer token" },
      });
      expect(providers[1]).toEqual({
        id: "local",
        type: "http",
        url: "http://localhost:3000",
        headers: undefined,
      });
    });

    it("extracts stdio providers correctly", () => {
      const mcpServers = {
        playwright: {
          command: "npx",
          args: ["@playwright/mcp"],
          env: { NODE_ENV: "test" },
        },
        filesystem: {
          command: "node",
          args: ["server.js", "--port", "8080"],
        },
      };

      const providers = extractProviders(mcpServers);

      expect(providers).toHaveLength(2);
      expect(providers[0]).toEqual({
        id: "playwright",
        type: "stdio",
        command: "npx",
        args: ["@playwright/mcp"],
        env: { NODE_ENV: "test" },
      });
      expect(providers[1]).toEqual({
        id: "filesystem",
        type: "stdio",
        command: "node",
        args: ["server.js", "--port", "8080"],
        env: undefined,
      });
    });

    it("skips agent-recorder itself", () => {
      const mcpServers = {
        "agent-recorder": {
          url: "http://127.0.0.1:8788/",
        },
        github: {
          url: "https://api.github.com/mcp",
        },
      };

      const providers = extractProviders(mcpServers);

      expect(providers).toHaveLength(1);
      expect(providers[0]?.id).toBe("github");
    });

    it("handles mixed HTTP and stdio providers", () => {
      const mcpServers = {
        github: {
          url: "https://api.github.com/mcp",
        },
        playwright: {
          command: "npx",
          args: ["@playwright/mcp"],
        },
        local: {
          url: "http://localhost:3000",
        },
      };

      const providers = extractProviders(mcpServers);

      expect(providers).toHaveLength(3);
      expect(providers.find((p) => p.id === "github")?.type).toBe("http");
      expect(providers.find((p) => p.id === "playwright")?.type).toBe("stdio");
      expect(providers.find((p) => p.id === "local")?.type).toBe("http");
    });

    it("skips invalid entries", () => {
      const mcpServers = {
        valid: {
          url: "http://localhost:3000",
        },
        invalid1: null,
        invalid2: "string",
        invalid3: [],
        invalid4: {
          // No url or command
          someField: "value",
        },
      };

      const providers = extractProviders(mcpServers);

      expect(providers).toHaveLength(1);
      expect(providers[0]?.id).toBe("valid");
    });

    it("returns empty array for empty mcpServers", () => {
      const providers = extractProviders({});
      expect(providers).toEqual([]);
    });
  });

  describe("hubifyClaudeConfig", () => {
    it("replaces mcpServers with only agent-recorder", () => {
      const claudeConfig = {
        mcpServers: {
          github: {
            url: "https://api.github.com/mcp",
          },
          playwright: {
            command: "npx",
            args: ["@playwright/mcp"],
          },
        },
        otherSetting: "preserved",
      };

      const result = hubifyClaudeConfig(claudeConfig, "http://127.0.0.1:8788/");

      expect(result.newClaudeConfig).toEqual({
        mcpServers: {
          "agent-recorder": {
            url: "http://127.0.0.1:8788/",
          },
        },
        otherSetting: "preserved",
      });
    });

    it("extracts providers from original config", () => {
      const claudeConfig = {
        mcpServers: {
          github: {
            url: "https://api.github.com/mcp",
          },
          playwright: {
            command: "npx",
            args: ["@playwright/mcp"],
          },
        },
      };

      const result = hubifyClaudeConfig(claudeConfig, "http://127.0.0.1:8788/");

      expect(result.providers).toHaveLength(2);
      expect(result.providers.find((p) => p.id === "github")).toBeDefined();
      expect(result.providers.find((p) => p.id === "playwright")).toBeDefined();
    });

    it("tracks imported and skipped keys", () => {
      const claudeConfig = {
        mcpServers: {
          "agent-recorder": {
            url: "http://127.0.0.1:8788/",
          },
          github: {
            url: "https://api.github.com/mcp",
          },
          playwright: {
            command: "npx",
            args: ["@playwright/mcp"],
          },
        },
      };

      const result = hubifyClaudeConfig(claudeConfig, "http://127.0.0.1:8788/");

      expect(result.importedKeys).toEqual(["github", "playwright"]);
      expect(result.skippedKeys).toEqual(["agent-recorder"]);
    });

    it("preserves all other Claude config fields", () => {
      const claudeConfig = {
        mcpServers: {
          github: {
            url: "https://api.github.com/mcp",
          },
        },
        plugins: ["some-plugin"],
        theme: "dark",
        editor: {
          fontSize: 14,
          tabSize: 2,
        },
      };

      const result = hubifyClaudeConfig(claudeConfig, "http://127.0.0.1:8788/");

      expect(result.newClaudeConfig.plugins).toEqual(["some-plugin"]);
      expect(result.newClaudeConfig.theme).toBe("dark");
      expect(result.newClaudeConfig.editor).toEqual({
        fontSize: 14,
        tabSize: 2,
      });
    });

    it("handles config with no mcpServers", () => {
      const claudeConfig = {
        theme: "dark",
      };

      const result = hubifyClaudeConfig(claudeConfig, "http://127.0.0.1:8788/");

      expect(result.newClaudeConfig).toEqual({
        theme: "dark",
        mcpServers: {
          "agent-recorder": {
            url: "http://127.0.0.1:8788/",
          },
        },
      });
      expect(result.providers).toEqual([]);
      expect(result.importedKeys).toEqual([]);
      expect(result.skippedKeys).toEqual([]);
    });

    it("handles config with only agent-recorder", () => {
      const claudeConfig = {
        mcpServers: {
          "agent-recorder": {
            url: "http://127.0.0.1:8788/",
          },
        },
      };

      const result = hubifyClaudeConfig(claudeConfig, "http://127.0.0.1:8788/");

      expect(result.providers).toEqual([]);
      expect(result.importedKeys).toEqual([]);
      expect(result.skippedKeys).toEqual(["agent-recorder"]);
    });
  });

  describe("mergeProviders", () => {
    it("adds new providers to empty file", () => {
      const existingFile: ProvidersFile = {
        version: 1,
        providers: [],
      };

      const newProviders: Provider[] = [
        {
          id: "github",
          type: "http",
          url: "https://api.github.com/mcp",
        },
      ];

      const result = mergeProviders(existingFile, newProviders);

      expect(result.version).toBe(1);
      expect(result.providers).toHaveLength(1);
      expect(result.providers[0]).toEqual(newProviders[0]);
    });

    it("replaces existing provider with same id", () => {
      const existingFile: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "github",
            type: "http",
            url: "https://old-url.com",
          },
        ],
      };

      const newProviders: Provider[] = [
        {
          id: "github",
          type: "http",
          url: "https://new-url.com",
        },
      ];

      const result = mergeProviders(existingFile, newProviders);

      expect(result.providers).toHaveLength(1);
      expect((result.providers[0] as HttpProvider).url).toBe(
        "https://new-url.com"
      );
    });

    it("merges new and existing providers", () => {
      const existingFile: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "existing",
            type: "http",
            url: "https://existing.com",
          },
        ],
      };

      const newProviders: Provider[] = [
        {
          id: "new",
          type: "stdio",
          command: "npx",
          args: ["@playwright/mcp"],
        },
      ];

      const result = mergeProviders(existingFile, newProviders);

      expect(result.providers).toHaveLength(2);
      expect(result.providers.find((p) => p.id === "existing")).toBeDefined();
      expect(result.providers.find((p) => p.id === "new")).toBeDefined();
    });

    it("handles multiple providers with same ids", () => {
      const existingFile: ProvidersFile = {
        version: 1,
        providers: [
          {
            id: "provider1",
            type: "http",
            url: "https://old1.com",
          },
          {
            id: "provider2",
            type: "http",
            url: "https://old2.com",
          },
        ],
      };

      const newProviders: Provider[] = [
        {
          id: "provider1",
          type: "http",
          url: "https://new1.com",
        },
        {
          id: "provider3",
          type: "stdio",
          command: "node",
        },
      ];

      const result = mergeProviders(existingFile, newProviders);

      expect(result.providers).toHaveLength(3);
      expect(
        (result.providers.find((p) => p.id === "provider1") as HttpProvider).url
      ).toBe("https://new1.com");
      expect(
        (result.providers.find((p) => p.id === "provider2") as HttpProvider).url
      ).toBe("https://old2.com");
      expect(result.providers.find((p) => p.id === "provider3")).toBeDefined();
    });
  });
});
