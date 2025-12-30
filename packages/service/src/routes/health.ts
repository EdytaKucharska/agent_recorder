/**
 * Health check endpoint with daemon diagnostics.
 */

import type { FastifyInstance } from "fastify";
import { getDaemonInfo } from "../index.js";

export async function registerHealthRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/api/health", async () => {
    const daemonInfo = getDaemonInfo();

    return {
      status: "ok",
      pid: process.pid,
      uptime: process.uptime(),
      mode: daemonInfo.mode,
      sessionId: daemonInfo.sessionId,
      startedAt: daemonInfo.startedAt,
    };
  });
}
