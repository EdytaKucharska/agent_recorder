/**
 * Tests for doctor command hub mode integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { doctorCommand } from "./doctor.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Doctor Command - Hub Mode", () => {
  let tempDir: string;
  let originalHome: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create temp directory to act as home
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-doctor-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tempDir;

    // Spy on console.log to capture output
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create .agent-recorder directory
    const dataDir = path.join(tempDir, ".agent-recorder");
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original HOME
    process.env.HOME = originalHome;

    // Restore console.log
    consoleLogSpy.mockRestore();

    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("shows hub mode disabled when no providers exist", async () => {
    // Run doctor command (will exit with error code, but we capture output)
    try {
      await doctorCommand();
    } catch {
      // Expected to fail since daemon isn't running
    }

    // Get all console.log calls
    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    // Verify hub mode section exists
    expect(output).toContain("Hub Mode");
    expect(output).toContain("Status:         disabled");
    expect(output).toContain("(no HTTP providers configured)");
  });

  it("shows hub mode enabled when HTTP providers exist", async () => {
    // Create providers.json with HTTP providers
    const dataDir = path.join(tempDir, ".agent-recorder");
    const providersPath = path.join(dataDir, "providers.json");

    const providersData = {
      version: 1,
      providers: [
        {
          id: "github",
          type: "http",
          url: "http://127.0.0.1:9999/",
        },
        {
          id: "playwright",
          type: "stdio",
          command: "npx",
          args: ["-y", "@playwright/mcp"],
        },
      ],
    };

    fs.writeFileSync(providersPath, JSON.stringify(providersData, null, 2));

    // Run doctor command
    try {
      await doctorCommand();
    } catch {
      // Expected to fail since daemon isn't running
    }

    // Get all console.log calls
    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    // Verify hub mode section shows enabled
    expect(output).toContain("Hub Mode");
    expect(output).toContain("Status:         enabled");
    expect(output).toContain("Total:          2");
    expect(output).toContain("HTTP:           1");
    expect(output).toContain("Reachable:      0/1"); // Provider not actually running
  });

  it("suggests hubify when Claude config exists but is not hubified", async () => {
    // Create providers.json
    const dataDir = path.join(tempDir, ".agent-recorder");
    const providersPath = path.join(dataDir, "providers.json");

    fs.writeFileSync(
      providersPath,
      JSON.stringify({
        version: 1,
        providers: [
          { id: "github", type: "http", url: "http://127.0.0.1:9999/" },
        ],
      })
    );

    // Create non-hubified Claude config
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    const claudeConfigPath = path.join(claudeDir, "settings.json");
    fs.writeFileSync(
      claudeConfigPath,
      JSON.stringify({
        mcpServers: {
          github: { url: "http://127.0.0.1:3000/" },
          playwright: { command: "npx", args: ["@playwright/mcp"] },
        },
      })
    );

    // Run doctor command
    try {
      await doctorCommand();
    } catch {
      // Expected to fail
    }

    // Get all console.log calls
    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    // Verify it shows not hubified
    expect(output).toContain("Claude Config:  not hubified");
    expect(output).toContain("Suggested Actions");
    expect(output).toContain("install (or configure claude --hubify)");
  });

  it("does not suggest hubify when Claude config is hubified", async () => {
    // Create providers.json
    const dataDir = path.join(tempDir, ".agent-recorder");
    const providersPath = path.join(dataDir, "providers.json");

    fs.writeFileSync(
      providersPath,
      JSON.stringify({
        version: 1,
        providers: [
          { id: "github", type: "http", url: "http://127.0.0.1:9999/" },
        ],
      })
    );

    // Create hubified Claude config (only agent-recorder entry)
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });

    const claudeConfigPath = path.join(claudeDir, "settings.json");
    fs.writeFileSync(
      claudeConfigPath,
      JSON.stringify({
        mcpServers: {
          "agent-recorder": { url: "http://127.0.0.1:8788/" },
        },
      })
    );

    // Run doctor command
    try {
      await doctorCommand();
    } catch {
      // Expected to fail
    }

    // Get all console.log calls
    const output = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

    // Verify it does NOT show "not hubified"
    expect(output).not.toContain("Claude Config:  not hubified");
  });
});
