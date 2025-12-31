#!/usr/bin/env node
/**
 * Agent Recorder - Distribution Entrypoint
 *
 * This is the main entry point for the distributed npm package.
 * It sets up module resolution to use vendor/ packages and then
 * runs the CLI.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set up NODE_PATH to include vendor/node_modules for @agent-recorder/* resolution
const vendorPath = join(__dirname, "..", "vendor", "node_modules");
if (process.env.NODE_PATH) {
  process.env.NODE_PATH = `${vendorPath}:${process.env.NODE_PATH}`;
} else {
  process.env.NODE_PATH = vendorPath;
}

// Re-initialize module resolution with updated NODE_PATH
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = createRequire(import.meta.url)("module");
Module._initPaths?.();

// Import and run the CLI
// The CLI is in vendor/node_modules/@agent-recorder/cli
const cliPath = join(vendorPath, "@agent-recorder", "cli", "index.js");
await import(cliPath);
