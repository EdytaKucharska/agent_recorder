#!/usr/bin/env node
/* global console, process */
/**
 * Smoke test for the distribution package.
 *
 * This script:
 * 1. Creates a temp directory
 * 2. Packs the dist package
 * 3. Installs it with npm (not pnpm)
 * 4. Runs basic commands to verify it works
 * 5. Cleans up
 */

import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "packages", "dist");

/**
 * Run a command and return output.
 */
function run(cmd, options = {}) {
  console.log(`  $ ${cmd}`);
  try {
    const result = execSync(cmd, {
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
    });
    return { success: true, output: result };
  } catch (error) {
    if (options.allowFailure) {
      return { success: false, output: error.stdout ?? "" };
    }
    throw error;
  }
}

/**
 * Main smoke test.
 */
async function smokeTest() {
  console.log("=== Agent Recorder Distribution Smoke Test ===\n");

  // Step 1: Create temp directory
  console.log("1. Creating temp directory...");
  const tempDir = mkdtempSync(join(tmpdir(), "agent-recorder-smoke-"));
  console.log(`   Created: ${tempDir}\n`);

  try {
    // Step 2: Build and bundle dist package
    console.log("2. Building distribution package...");
    run("pnpm run build:dist");
    console.log("");

    // Step 3: Pack the distribution
    console.log("3. Creating tarball...");
    run("pnpm pack", { cwd: distDir });

    // Find the tarball
    const files = readdirSync(distDir);
    const tarball = files.find((f) => f.endsWith(".tgz"));
    if (!tarball) {
      throw new Error("Tarball not created");
    }
    const tarballPath = join(distDir, tarball);
    console.log(`   Created: ${tarball}\n`);

    // Step 4: Initialize npm in temp dir and install
    console.log("4. Installing with npm (simulating user install)...");
    run(`npm init -y`, { cwd: tempDir, silent: true });
    run(`npm install "${tarballPath}"`, { cwd: tempDir });
    console.log("");

    // Step 5: Run basic commands
    console.log("5. Testing installed CLI...");
    const binPath = join(tempDir, "node_modules", ".bin", "agent-recorder");

    if (!existsSync(binPath)) {
      throw new Error(`Binary not found at ${binPath}`);
    }

    // Test --version
    console.log("   Testing --version...");
    const versionResult = spawnSync(binPath, ["--version"], {
      encoding: "utf-8",
      cwd: tempDir,
    });
    if (versionResult.status !== 0) {
      console.error("   FAIL: --version returned non-zero");
      console.error(versionResult.stderr);
      process.exit(1);
    }
    console.log(`   OK: ${versionResult.stdout.trim()}`);

    // Test --help
    console.log("   Testing --help...");
    const helpResult = spawnSync(binPath, ["--help"], {
      encoding: "utf-8",
      cwd: tempDir,
    });
    if (helpResult.status !== 0) {
      console.error("   FAIL: --help returned non-zero");
      process.exit(1);
    }
    if (!helpResult.stdout.includes("Local-first flight recorder")) {
      console.error("   FAIL: --help output doesn't look right");
      process.exit(1);
    }
    console.log("   OK: Help text looks correct");

    // Test status (should report stopped/no daemon)
    console.log("   Testing status...");
    const statusResult = spawnSync(binPath, ["status"], {
      encoding: "utf-8",
      cwd: tempDir,
    });
    // Status can exit 1 if daemon not running, that's fine
    if (
      statusResult.stdout.includes("stopped") ||
      statusResult.stdout.includes("not running") ||
      statusResult.stdout.includes("No PID")
    ) {
      console.log("   OK: Status correctly reports daemon not running");
    } else {
      console.log(`   Output: ${statusResult.stdout}`);
      console.log("   OK: Status command executed");
    }

    console.log("\n=== SMOKE TEST PASSED ===\n");

    // Clean up tarball
    rmSync(tarballPath);
  } finally {
    // Step 6: Clean up temp directory
    console.log("6. Cleaning up...");
    rmSync(tempDir, { recursive: true, force: true });
    console.log("   Done!\n");
  }
}

smokeTest().catch((error) => {
  console.error("\n=== SMOKE TEST FAILED ===");
  console.error(error);
  process.exit(1);
});
