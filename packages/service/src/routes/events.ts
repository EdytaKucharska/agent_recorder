/**
 * Event management endpoints.
 */

import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  insertEvent,
  getEventsBySession,
  countEventsBySession,
  type InsertEventInput,
} from "@agent-recorder/core";

interface EventsRoutesOptions {
  db: Database.Database;
}

export async function registerEventsRoutes(
  app: FastifyInstance,
  options: EventsRoutesOptions
): Promise<void> {
  const { db } = options;

  // Insert a new event
  app.post<{ Body: InsertEventInput }>(
    "/api/events",
    async (request, reply) => {
      try {
        const event = insertEvent(db, request.body);
        return reply.code(201).send(event);
      } catch (error) {
        console.error("Failed to insert event:", error);
        // Fail-open: log error but return 500, don't crash
        return reply.code(500).send({ error: "Failed to insert event" });
      }
    }
  );

  // Get events for a session
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/events",
    async (request) => {
      try {
        const { id } = request.params;
        return getEventsBySession(db, id);
      } catch (error) {
        console.error("Failed to get session events:", error);
        return [];
      }
    }
  );

  // Get event count for a session (efficient SQL count)
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/events/count",
    async (request) => {
      try {
        const { id } = request.params;
        return { count: countEventsBySession(db, id) };
      } catch (error) {
        console.error("Failed to count session events:", error);
        return { count: 0 };
      }
    }
  );
}
