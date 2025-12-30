/**
 * Status command - check if daemon is running via health endpoint.
 */

import { loadConfig } from "@agent-recorder/core";

export async function statusCommand(): Promise<void> {
  const config = loadConfig();
  const url = `http://127.0.0.1:${config.listenPort}/api/health`;

  try {
    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      console.log(`Daemon is running on port ${config.listenPort}`);
      console.log(`Health: ${JSON.stringify(data)}`);
    } else {
      console.log(`Daemon responded with status ${response.status}`);
    }
  } catch {
    console.log("Daemon is not running");
    process.exit(1);
  }
}
