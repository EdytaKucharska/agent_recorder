/**
 * Health check endpoint.
 */

import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/api/health", async () => {
    return { status: "ok" };
  });
}
