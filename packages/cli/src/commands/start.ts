/**
 * Start command - runs the daemon in foreground.
 */

import { loadConfig } from "@agent-recorder/core";
import { startDaemon } from "@agent-recorder/service";

function printStartupBanner(mcpProxyPort: number): void {
  console.log(`
Agent Recorder
==============
To connect Claude Code, add to ~/.config/claude/mcp.json:

  {
    "mcpServers": {
      "agent-recorder": {
        "url": "http://127.0.0.1:${mcpProxyPort}/"
      }
    }
  }

Then restart Claude Code.
`);
}

export async function startCommand(): Promise<void> {
  const config = loadConfig();
  printStartupBanner(config.mcpProxyPort);
  await startDaemon();
}
