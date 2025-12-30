/**
 * Install command - set up ~/.agent-recorder/ and print configuration.
 * This command is idempotent - it won't overwrite existing files.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@agent-recorder/core";

/** Default .env file template */
const ENV_TEMPLATE = `# Agent Recorder Configuration
# See docs/bootstrap.md for more options

# Ports
AR_LISTEN_PORT=8787
AR_MCP_PROXY_PORT=8788

# Database path (default is ~/.agent-recorder/agent-recorder.sqlite)
# AR_DB_PATH=

# Downstream MCP server (optional)
# AR_DOWNSTREAM_MCP_URL=http://127.0.0.1:9999

# Debug logging for MCP proxy (1 to enable)
# AR_DEBUG_PROXY=1
`;

/**
 * Install Agent Recorder - create data directory and env file template.
 * This command is idempotent:
 * - Creates ~/.agent-recorder/ if it doesn't exist
 * - Creates ~/.agent-recorder/.env ONLY if it doesn't exist
 * - Never overwrites user files
 */
export async function installCommand(): Promise<void> {
  const config = loadConfig();
  const dataDir = join(homedir(), ".agent-recorder");
  const envFile = join(dataDir, ".env");

  // Create data directory if missing
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`Created: ${dataDir}`);
  } else {
    console.log(`Already exists: ${dataDir}`);
  }

  // Create .env file ONLY if it doesn't exist
  if (!existsSync(envFile)) {
    writeFileSync(envFile, ENV_TEMPLATE);
    console.log(`Created: ${envFile}`);
  } else {
    console.log(`Already exists: ${envFile}`);
  }

  // Print next steps
  console.log(`
Agent Recorder installed!

Data directory: ${dataDir}
Env file: ${envFile}

Claude Code v2 (recommended):
Add to ~/.claude/settings.json:

{
  "mcpServers": {
    "agent-recorder": {
      "url": "http://127.0.0.1:${config.mcpProxyPort}/"
    }
  }
}

Next steps:
1. Edit ${envFile} if needed
2. Start the daemon: agent-recorder start --env-file ${envFile}
3. Restart Claude Code to connect
`);
}
