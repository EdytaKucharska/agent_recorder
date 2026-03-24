/**
 * Token monitoring endpoints.
 */

import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getTokenSummary } from "@agent-recorder/core";

interface TokensRoutesOptions {
  db: Database.Database;
  contextBudgetTokens: number;
}

export async function registerTokensRoutes(
  app: FastifyInstance,
  options: TokensRoutesOptions
): Promise<void> {
  const { db, contextBudgetTokens } = options;

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/tokens",
    async (request, reply) => {
      try {
        const { sessionId } = request.params;
        return getTokenSummary(db, sessionId, contextBudgetTokens);
      } catch (error) {
        console.error("Failed to get token summary:", error);
        return reply.code(500).send({ error: "Failed to get token summary" });
      }
    }
  );
}
