/**
 * Fastify server factory.
 * Creates and configures the daemon server.
 */

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
 * Start the server on localhost only.
 * If the preferred port is in use, tries up to 10 sequential ports.
 * Returns the actual port the server bound to.
 */
export async function startServer(
  app: FastifyInstance,
  preferredPort: number
): Promise<number> {
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const port = preferredPort + i;
    try {
      await app.listen({ port, host: "127.0.0.1" });
      if (i > 0) {
        console.log(
          `Port ${preferredPort} in use — bound to http://127.0.0.1:${port} instead`
        );
      } else {
        console.log(
          `Agent Recorder daemon listening on http://127.0.0.1:${port}`
        );
      }
      return port;
    } catch (err) {
      const error = err as { code?: string };
      if (error.code !== "EADDRINUSE" || i === maxAttempts - 1) {
        throw err;
      }
      console.log(`Port ${port} in use, trying ${port + 1}...`);
    }
  }

  // Unreachable — satisfies TypeScript
  throw new Error(
    `No available port in range ${preferredPort}–${preferredPort + maxAttempts - 1}`
  );
}
