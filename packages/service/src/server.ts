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
 */
export async function startServer(
  app: FastifyInstance,
  port: number
): Promise<void> {
  await app.listen({
    port,
    host: "127.0.0.1", // localhost only
  });
  console.log(`Agent Recorder daemon listening on http://127.0.0.1:${port}`);
}
