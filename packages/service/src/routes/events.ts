/**
 * Event management endpoints.
 */

import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  insertEvent,
  getEventsBySession,
  getEventsBySessionPaginated,
  countEventsBySession,
  getLatestToolCallEvent,
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

  // Get events for a session with optional after/limit for tailing
  app.get<{
    Params: { id: string };
    Querystring: { after?: string; limit?: string };
  }>("/api/sessions/:id/events", async (request) => {
    try {
      const { id } = request.params;
      const { after, limit } = request.query;

      // If no query params, return all events (legacy behavior)
      if (after === undefined && limit === undefined) {
        return getEventsBySession(db, id);
      }

      // Use paginated query
      return getEventsBySessionPaginated(db, id, {
        after: after ? parseInt(after, 10) : 0,
        limit: limit ? parseInt(limit, 10) : 200,
      });
    } catch (error) {
      console.error("Failed to get session events:", error);
      return [];
    }
  });

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

  // Get latest tool_call event for a session (used by doctor command)
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/events/latest-tool-call",
    async (request, reply) => {
      try {
        const { id } = request.params;
        const event = getLatestToolCallEvent(db, id);
        if (event) {
          // Return minimal info needed by doctor
          return {
            toolName: event.toolName,
            mcpMethod: event.mcpMethod,
            startedAt: event.startedAt,
          };
        }
        return reply.code(404).send({ error: "No tool_call events found" });
      } catch (error) {
        console.error("Failed to get latest tool_call event:", error);
        return reply.code(500).send({ error: "Failed to get event" });
      }
    }
  );
}
