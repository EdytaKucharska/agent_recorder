/**
 * Tests for install command with automatic hubify configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installCommand } from "./install.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Install Command", () => {
  let tempDir: string;
  let originalHome: string;
  let mockClaudeConfigPath: string;

  beforeEach(() => {
    // Create temp directory to act as home
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-install-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tempDir;

    // Create mock Claude config directory
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    mockClaudeConfigPath = path.join(claudeDir, "settings.json");
  });

  afterEach(() => {
    // Restore original HOME
    process.env.HOME = originalHome;

    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates .agent-recorder directory and files", async () => {
    await installCommand({ noConfigure: true });

    const dataDir = path.join(tempDir, ".agent-recorder");
    const envFile = path.join(dataDir, ".env");
    const upstreamsFile = path.join(dataDir, "upstreams.json");

    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.existsSync(envFile)).toBe(true);
    expect(fs.existsSync(upstreamsFile)).toBe(true);

    // Verify .env has expected content
    const envContent = fs.readFileSync(envFile, "utf-8");
    expect(envContent).toContain("AR_LISTEN_PORT=8787");
    expect(envContent).toContain("AR_MCP_PROXY_PORT=8788");

    // Verify upstreams.json is empty object
    const upstreamsContent = fs.readFileSync(upstreamsFile, "utf-8");
    expect(upstreamsContent.trim()).toBe("{}");
  });

  it("is idempotent - does not overwrite existing files", async () => {
    const dataDir = path.join(tempDir, ".agent-recorder");
    const envFile = path.join(dataDir, ".env");

    // First run
    await installCommand({ noConfigure: true });

    // Modify .env file
    fs.writeFileSync(envFile, "# Custom config\nAR_LISTEN_PORT=9999\n");

    // Second run
    await installCommand({ noConfigure: true });

    // Verify .env was NOT overwritten
    const envContent = fs.readFileSync(envFile, "utf-8");
    expect(envContent).toContain("# Custom config");
    expect(envContent).toContain("AR_LISTEN_PORT=9999");
    expect(envContent).not.toContain("AR_LISTEN_PORT=8787");
  });

  it("automatically hubifies Claude config when Claude config exists", async () => {
    // Create mock Claude config with existing MCP servers
    const mockConfig = {
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
    fs.writeFileSync(mockClaudeConfigPath, JSON.stringify(mockConfig, null, 2));

    // Run install (hubify should run automatically)
    await installCommand();

    // Verify Claude config was updated
    const updatedConfig = JSON.parse(
      fs.readFileSync(mockClaudeConfigPath, "utf-8")
    );

    // Should only have agent-recorder entry
    expect(Object.keys(updatedConfig.mcpServers)).toEqual(["agent-recorder"]);
    expect(updatedConfig.mcpServers["agent-recorder"]).toEqual({
      url: "http://127.0.0.1:8788/",
    });

    // Should preserve other settings
    expect(updatedConfig.otherSetting).toBe("preserved");

    // Verify backup was created
    const backupFiles = fs
      .readdirSync(path.join(tempDir, ".claude"))
      .filter((f) => f.startsWith("settings.json") && f.includes(".bak"));
    expect(backupFiles.length).toBeGreaterThan(0);

    // Verify providers.json was created
    const providersPath = path.join(
      tempDir,
      ".agent-recorder",
      "providers.json"
    );
    expect(fs.existsSync(providersPath)).toBe(true);

    const providersFile = JSON.parse(fs.readFileSync(providersPath, "utf-8"));

    // Should have 2 providers (github and playwright)
    expect(providersFile.version).toBe(1);
    expect(providersFile.providers).toHaveLength(2);

    const providerIds = providersFile.providers.map(
      (p: { id: string }) => p.id
    );
    expect(providerIds).toContain("github");
    expect(providerIds).toContain("playwright");

    // Verify provider types
    const githubProvider = providersFile.providers.find(
      (p: { id: string }) => p.id === "github"
    );
    expect(githubProvider.type).toBe("http");
    expect(githubProvider.url).toBe("https://api.github.com/mcp");

    const playwrightProvider = providersFile.providers.find(
      (p: { id: string }) => p.id === "playwright"
    );
    expect(playwrightProvider.type).toBe("stdio");
    expect(playwrightProvider.command).toBe("npx");
    expect(playwrightProvider.args).toEqual(["@playwright/mcp"]);
  });

  it("skips hubify when --no-configure is specified", async () => {
    // Create mock Claude config
    const mockConfig = {
      mcpServers: {
        github: {
          url: "https://api.github.com/mcp",
        },
      },
    };
    fs.writeFileSync(mockClaudeConfigPath, JSON.stringify(mockConfig, null, 2));

    // Run install with --no-configure
    await installCommand({ noConfigure: true });

    // Verify Claude config was NOT modified
    const config = JSON.parse(fs.readFileSync(mockClaudeConfigPath, "utf-8"));
    expect(config.mcpServers.github).toEqual({
      url: "https://api.github.com/mcp",
    });

    // Should not have agent-recorder entry
    expect(config.mcpServers["agent-recorder"]).toBeUndefined();

    // Verify providers.json was NOT created
    const providersPath = path.join(
      tempDir,
      ".agent-recorder",
      "providers.json"
    );
    expect(fs.existsSync(providersPath)).toBe(false);

    // Verify no backup was created
    const backupFiles = fs
      .readdirSync(path.join(tempDir, ".claude"))
      .filter((f) => f.includes(".bak"));
    expect(backupFiles).toHaveLength(0);
  });

  it("handles case when Claude config does not exist", async () => {
    // Don't create Claude config - it doesn't exist

    // Run install (should handle gracefully)
    await installCommand();

    // Should still create .agent-recorder directory
    const dataDir = path.join(tempDir, ".agent-recorder");
    expect(fs.existsSync(dataDir)).toBe(true);

    // Should not crash or create providers.json
    const providersPath = path.join(dataDir, "providers.json");
    expect(fs.existsSync(providersPath)).toBe(false);
  });

  it("skips already-agent-recorder entries during hubify", async () => {
    // Create mock Claude config that already has agent-recorder
    const mockConfig = {
      mcpServers: {
        "agent-recorder": {
          url: "http://127.0.0.1:8788/",
        },
        github: {
          url: "https://api.github.com/mcp",
        },
      },
    };
    fs.writeFileSync(mockClaudeConfigPath, JSON.stringify(mockConfig, null, 2));

    // Run install
    await installCommand();

    // Verify providers.json has only github (not agent-recorder)
    const providersPath = path.join(
      tempDir,
      ".agent-recorder",
      "providers.json"
    );
    const providersFile = JSON.parse(fs.readFileSync(providersPath, "utf-8"));

    expect(providersFile.providers).toHaveLength(1);
    expect(providersFile.providers[0].id).toBe("github");
  });
});
