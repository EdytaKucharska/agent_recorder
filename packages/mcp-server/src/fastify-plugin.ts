/**
 * Fastify plugin that mounts the Agent Recorder MCP server at /mcp.
 *
 * Uses StreamableHTTPServerTransport in stateful mode.
 * Each MCP session gets its own transport instance, tracked by session ID.
 * Cleanup happens on Fastify close.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpServer } from "./server.js";
import type { McpServerOptions } from "./server.js";

export function createFastifyPlugin(opts: McpServerOptions) {
  return async function mcpPlugin(app: FastifyInstance): Promise<void> {
    // Map of MCP session ID → transport, for routing stateful requests
    const transports = new Map<string, StreamableHTTPServerTransport>();

    // Clean up all transports when Fastify closes
    app.addHook("onClose", async () => {
      for (const transport of transports.values()) {
        await transport.close().catch(() => {
          /* ignore close errors during shutdown */
        });
      }
      transports.clear();
    });

    /**
     * POST /mcp — handle MCP client messages.
     * Initialization (no Mcp-Session-Id header) creates a new transport + server pair.
     * Subsequent requests are routed to the existing transport by session ID.
     */
    app.post("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = request.headers["mcp-session-id"] as string | undefined;

      let transport: StreamableHTTPServerTransport;

      if (sessionId) {
        // Route to existing session
        const existing = transports.get(sessionId);
        if (!existing) {
          return reply
            .code(404)
            .send({ error: "Session not found", sessionId });
        }
        transport = existing;
      } else {
        // New session — create transport + server pair
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        transport.onclose = () => {
          const tid = transport.sessionId;
          if (tid) transports.delete(tid);
        };

        const server = createMcpServer(opts);
        // Cast needed: exactOptionalPropertyTypes makes SDK's optional `onclose`
        // incompatible with the Transport interface when assigned externally.
        await server.connect(transport as unknown as Transport);

        // Session ID is set after connect; store by it
        const tid = transport.sessionId;
        if (tid) {
          transports.set(tid, transport);
        }
      }

      await transport.handleRequest(request.raw, reply.raw, request.body);
    });

    /**
     * GET /mcp — SSE stream for server-initiated messages (resumable streams).
     */
    app.get("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = request.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) {
        return reply
          .code(400)
          .send({ error: "Mcp-Session-Id header required" });
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        return reply.code(404).send({ error: "Session not found", sessionId });
      }

      await transport.handleRequest(request.raw, reply.raw);
    });

    /**
     * DELETE /mcp — explicit session termination.
     */
    app.delete("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = request.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) {
        return reply
          .code(400)
          .send({ error: "Mcp-Session-Id header required" });
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        return reply.code(404).send({ error: "Session not found", sessionId });
      }

      await transport.handleRequest(request.raw, reply.raw);
    });
  };
}
