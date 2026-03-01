/**
 * Fastify server factory.
 * Creates and configures the daemon server.
 */

import { createServer as createTcpServer } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionsRoutes } from "./routes/sessions.js";
import { registerEventsRoutes } from "./routes/events.js";
import { registerHooksRoutes } from "./routes/hooks.js";
import { registerStdioRoutes } from "./routes/stdio.js";

export interface CreateServerOptions {
  db: Database.Database;
  currentSessionId?: string | null;
  debug?: boolean;
}

/**
 * Create a configured Fastify server instance.
 */
export async function createServer(
  options: CreateServerOptions
): Promise<FastifyInstance> {
  const { db, currentSessionId, debug } = options;

  const app = Fastify({
    logger: true,
  });

  // Register routes
  await registerHealthRoutes(app);
  await registerSessionsRoutes(app, {
    db,
    currentSessionId: currentSessionId ?? null,
  });
  await registerEventsRoutes(app, { db });
  await registerHooksRoutes(app, { db, debug: debug ?? false });
  await registerStdioRoutes(app, { db, debug: debug ?? false });

  return app;
}

/**
 * Check if a port is available by attempting to bind a temporary server.
 * This avoids calling Fastify's listen() multiple times on the same instance.
 */
function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createTcpServer();
    server.on("error", () => resolve(false));
    server.on("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * Find the first available port in a range.
 * Returns the port number or null if none available.
 */
async function findAvailablePort(
  preferredPort: number,
  maxAttempts: number,
  host: string
): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferredPort + i;
    // Bounds check: valid port range is 1-65535
    if (port > 65535) {
      return null;
    }
    if (await isPortAvailable(port, host)) {
      return port;
    }
    console.log(`Port ${port} in use, trying ${port + 1}...`);
  }
  return null;
}

/**
 * Start the server on localhost only.
 * If the preferred port is in use, tries up to 10 sequential ports.
 * Returns the actual port the server bound to.
 */
export async function startServer(
  app: FastifyInstance,
  preferredPort: number
): Promise<number> {
  const maxAttempts = 10;
  const host = "127.0.0.1";

  // Find an available port first (avoids calling app.listen multiple times)
  const port = await findAvailablePort(preferredPort, maxAttempts, host);

  if (port === null) {
    const maxPort = Math.min(preferredPort + maxAttempts - 1, 65535);
    throw new Error(`No available port in range ${preferredPort}-${maxPort}`);
  }

  // Now call app.listen exactly once
  await app.listen({ port, host });

  if (port !== preferredPort) {
    console.log(
      `Port ${preferredPort} in use - bound to http://${host}:${port} instead`
    );
  } else {
    console.log(`Agent Recorder daemon listening on http://${host}:${port}`);
  }

  return port;
}
