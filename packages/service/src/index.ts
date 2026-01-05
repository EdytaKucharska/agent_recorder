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
  getDaemonPaths,
  writePidFile,
  removePidFile,
  releaseLock,
  installTimestampLogging,
  readProvidersFile,
  getDefaultProvidersPath,
  type SessionStatus,
} from "@agent-recorder/core";
import { createServer, startServer } from "./server.js";
import { createMcpProxy } from "./mcp/index.js";
import { createSessionManager } from "./session-manager.js";
import { AutoWrapManager } from "./mcp/auto-wrap-manager.js";

export { createServer, startServer } from "./server.js";
export { createMcpProxy } from "./mcp/index.js";
export { createSessionManager } from "./session-manager.js";

export interface DaemonHandle {
  shutdown: (status?: SessionStatus) => Promise<void>;
  sessionId: string;
  startedAt: string;
}

export interface DaemonOptions {
  /** Run in daemon mode (writes PID file, different shutdown behavior) */
  daemon?: boolean;
}

// Track daemon state for health endpoint
let daemonMode = false;
let daemonSessionId: string | null = null;
let daemonStartedAt: string | null = null;

/**
 * Get daemon runtime info for health endpoint.
 */
export function getDaemonInfo(): {
  mode: "daemon" | "foreground";
  sessionId: string | null;
  startedAt: string | null;
} {
  return {
    mode: daemonMode ? "daemon" : "foreground",
    sessionId: daemonSessionId,
    startedAt: daemonStartedAt,
  };
}

/**
 * Start the daemon with default configuration.
 * Used by CLI and for direct execution.
 *
 * @param options - Daemon options (daemon mode, etc.)
 */
export async function startDaemon(
  options: DaemonOptions = {}
): Promise<DaemonHandle> {
  // Install timestamp logging before any console output
  installTimestampLogging();

  const config = loadConfig();
  const paths = getDaemonPaths();
  daemonMode = options.daemon ?? false;

  console.log("Starting Agent Recorder daemon...");
  console.log(`Mode: ${daemonMode ? "daemon" : "foreground"}`);
  console.log(`Database: ${config.dbPath}`);
  console.log(`REST API port: ${config.listenPort}`);

  // Open database
  const db = openDatabase(config.dbPath);

  // Run migrations
  const migrationsDir = getDefaultMigrationsDir();
  runMigrations(db, migrationsDir);

  // Create session manager (core generates ID)
  const sessionManager = createSessionManager(db);
  const startedAt = new Date().toISOString();

  // Store for health endpoint
  daemonSessionId = sessionManager.sessionId;
  daemonStartedAt = startedAt;

  // Initialize auto-wrap manager (fail-open: errors logged, not thrown)
  let autoWrapManager: AutoWrapManager | null = null;
  try {
    autoWrapManager = new AutoWrapManager({
      config,
      sessionId: sessionManager.sessionId,
      db,
    });
    await autoWrapManager.initialize();
  } catch (error) {
    console.error(
      "[AutoWrap] Initialization failed:",
      error instanceof Error ? error.message : "Unknown error"
    );
    console.error("Continuing in manual wrap mode...");
  }

  // Create and start REST API server (pass currentSessionId for /api/sessions/current)
  const app = await createServer({
    db,
    currentSessionId: sessionManager.sessionId,
  });
  await startServer(app, config.listenPort);

  // Always start MCP proxy (handles missing downstream with 503)
  console.log(`MCP proxy port: ${config.mcpProxyPort}`);

  // Show mode status - hub mode takes precedence
  const providersFile = readProvidersFile(getDefaultProvidersPath());
  const httpProviders = providersFile.providers.filter(
    (p) => p.type === "http"
  );

  if (httpProviders.length > 0) {
    console.log(
      `Hub mode: ${httpProviders.length} provider(s) [${httpProviders.map((p) => p.id).join(", ")}]`
    );
  } else if (config.downstreamMcpUrl) {
    console.log(`Legacy mode: ${config.downstreamMcpUrl}`);
  } else {
    console.log(
      "No providers configured. Run 'agent-recorder install' to set up hub mode."
    );
  }

  const proxy = await createMcpProxy({
    db,
    config,
    sessionId: sessionManager.sessionId,
  });
  await proxy.start();

  // Write PID file only in daemon mode
  if (daemonMode) {
    writePidFile(process.pid);
    console.log(`PID file: ${paths.pidFile}`);
  }

  console.log("Agent Recorder daemon started.");

  // Track if we're already shutting down to prevent double shutdown
  let isShuttingDown = false;

  // Graceful shutdown function
  const shutdown = async (status: SessionStatus = "cancelled") => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    console.log(`\nShutting down (status: ${status})...`);
    sessionManager.shutdown(status);
    await proxy.close();
    await app.close();

    // Cleanup auto-wrap manager
    if (autoWrapManager) {
      await autoWrapManager.cleanup();
    }

    db.close();

    // Clean up PID file and lock in daemon mode
    if (daemonMode) {
      removePidFile();
      releaseLock(paths.lockFile);
    }

    console.log("Shutdown complete.");
  };

  // Signal handlers:
  // SIGINT (Ctrl+C) → completed (user intentionally stopped)
  // SIGTERM → cancelled (external termination)
  process.on("SIGINT", () => shutdown("completed").then(() => process.exit(0)));
  process.on("SIGTERM", () =>
    shutdown("cancelled").then(() => process.exit(0))
  );

  // Ignore SIGHUP (no reload needed)
  process.on("SIGHUP", () => {
    console.log("Received SIGHUP, ignoring.");
  });

  return {
    shutdown,
    sessionId: sessionManager.sessionId,
    startedAt,
  };
}

// Run if executed directly
// Note: pathToFileURL handles spaces and special characters correctly
import { pathToFileURL } from "node:url";
const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const isDaemon = args.includes("--daemon");

  startDaemon({ daemon: isDaemon }).catch((error) => {
    console.error("Failed to start daemon:", error);
    process.exit(1);
  });
}
