/**
 * @agent-recorder/service
 *
 * Local daemon for Agent Recorder.
 * Runs SQLite persistence + REST API on localhost.
 * Always runs MCP proxy (returns 503 if downstream not configured).
 */

import {
  loadConfig,
  openDatabase,
  runMigrations,
  getDefaultMigrationsDir,
  type SessionStatus,
} from "@agent-recorder/core";
import { createServer, startServer } from "./server.js";
import { createMcpProxy } from "./mcp/index.js";
import { createSessionManager } from "./session-manager.js";

export { createServer, startServer } from "./server.js";
export { createMcpProxy } from "./mcp/index.js";
export { createSessionManager } from "./session-manager.js";

export interface DaemonHandle {
  shutdown: (status?: SessionStatus) => Promise<void>;
}

/**
 * Start the daemon with default configuration.
 * Used by CLI and for direct execution.
 */
export async function startDaemon(): Promise<DaemonHandle> {
  const config = loadConfig();

  console.log("Starting Agent Recorder daemon...");
  console.log(`Database: ${config.dbPath}`);
  console.log(`REST API port: ${config.listenPort}`);

  // Open database
  const db = openDatabase(config.dbPath);

  // Run migrations
  const migrationsDir = getDefaultMigrationsDir();
  runMigrations(db, migrationsDir);

  // Create session manager (core generates ID)
  const sessionManager = createSessionManager(db);

  // Create and start REST API server
  const app = await createServer({ db });
  await startServer(app, config.listenPort);

  // Always start MCP proxy (handles missing downstream with 503)
  console.log(`MCP proxy port: ${config.mcpProxyPort}`);
  if (config.downstreamMcpUrl) {
    console.log(`Downstream MCP: ${config.downstreamMcpUrl}`);
  } else {
    console.log("Downstream MCP: not configured (POST / will return 503)");
  }

  const proxy = await createMcpProxy({
    db,
    config,
    sessionId: sessionManager.sessionId,
  });
  await proxy.start();

  // Graceful shutdown function
  const shutdown = async (status: SessionStatus = "cancelled") => {
    console.log("\nShutting down...");
    sessionManager.shutdown(status);
    await proxy.close();
    await app.close();
    db.close();
  };

  // Signal handlers use "cancelled" status
  process.on("SIGINT", () => shutdown("cancelled").then(() => process.exit(0)));
  process.on("SIGTERM", () =>
    shutdown("cancelled").then(() => process.exit(0))
  );

  return { shutdown };
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startDaemon().catch((error) => {
    console.error("Failed to start daemon:", error);
    process.exit(1);
  });
}
