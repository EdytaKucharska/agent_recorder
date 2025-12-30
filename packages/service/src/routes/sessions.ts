/**
 * Session management endpoints.
 */

import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  createSession,
  endSession,
  getSessionById,
  listSessions,
  type SessionStatus,
} from "@agent-recorder/core";
import { randomUUID } from "node:crypto";

interface SessionsRoutesOptions {
  db: Database.Database;
}

export async function registerSessionsRoutes(
  app: FastifyInstance,
  options: SessionsRoutesOptions
): Promise<void> {
  const { db } = options;

  // Create a new session
  app.post("/api/sessions", async (request, reply) => {
    try {
      const id = randomUUID();
      const startedAt = new Date().toISOString();
      const session = createSession(db, id, startedAt);
      return reply.code(201).send(session);
    } catch (error) {
      console.error("Failed to create session:", error);
      return reply.code(500).send({ error: "Failed to create session" });
    }
  });

  // End a session
  app.post<{ Params: { id: string }; Body: { status?: SessionStatus } }>(
    "/api/sessions/:id/end",
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { status } = request.body ?? {};
        const endedAt = new Date().toISOString();
        const session = endSession(db, id, endedAt, status ?? "completed");

        if (!session) {
          return reply.code(404).send({ error: "Session not found" });
        }

        return session;
      } catch (error) {
        console.error("Failed to end session:", error);
        return reply.code(500).send({ error: "Failed to end session" });
      }
    }
  );

  // List sessions
  app.get<{ Querystring: { status?: SessionStatus } }>(
    "/api/sessions",
    async (request) => {
      try {
        const { status } = request.query;
        return listSessions(db, status);
      } catch (error) {
        console.error("Failed to list sessions:", error);
        return [];
      }
    }
  );

  // Get session by ID
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (request, reply) => {
      try {
        const { id } = request.params;
        const session = getSessionById(db, id);

        if (!session) {
          return reply.code(404).send({ error: "Session not found" });
        }

        return session;
      } catch (error) {
        console.error("Failed to get session:", error);
        return reply.code(500).send({ error: "Failed to get session" });
      }
    }
  );
}
