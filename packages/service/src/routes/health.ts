/**
 * Health check endpoint with daemon diagnostics.
 */

import type { FastifyInstance } from "fastify";
import type { DaemonContext } from "../daemon-context.js";

interface HealthRoutesOptions {
  daemonContext?: DaemonContext | undefined;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions = {}
): Promise<void> {
  const { daemonContext } = options;

  app.get("/api/health", async () => {
    return {
      status: "ok",
      pid: process.pid,
      uptime: process.uptime(),
      mode: daemonContext?.mode ?? "foreground",
      sessionId: daemonContext?.sessionId ?? null,
      startedAt: daemonContext?.startedAt ?? null,
    };
  });
}
