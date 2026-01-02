/**
 * Tests for MCP Hub mode.
 * Verifies tools/list aggregation and tools/call routing with multiple providers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import {
  loadConfig,
  openMemoryDatabase,
  runMigrations,
  writeProvidersFile,
  getDefaultProvidersPath,
} from "@agent-recorder/core";
import { createMcpProxy } from "./proxy.js";
import * as fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create a mock MCP server that responds to tools/list and tools/call.
 */
async function createMockMcpServer(
  port: number,
  tools: Array<{ name: string; description: string }>
): Promise<{ app: FastifyInstance; close: () => Promise<void> }> {
  const app = Fastify({ logger: false });

  // Mock tools/list endpoint
  app.post("/", async (request, reply) => {
    const body = request.body as {
      method: string;
      params?: unknown;
      id?: unknown;
    };

    if (body.method === "tools/list") {
      return reply.code(200).send({
        jsonrpc: "2.0",
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: { type: "object", properties: {} },
          })),
        },
        id: body.id ?? null,
      });
    }

    if (body.method === "tools/call") {
      const params = body.params as { name: string; arguments?: unknown };
      const tool = tools.find((t) => t.name === params.name);

      if (!tool) {
        return reply.code(200).send({
          jsonrpc: "2.0",
          error: {
            code: -32602,
            message: `Unknown tool: ${params.name}`,
          },
          id: body.id ?? null,
        });
      }

      return reply.code(200).send({
        jsonrpc: "2.0",
        result: { success: true, tool: params.name },
        id: body.id ?? null,
      });
    }

    return reply.code(400).send({
      jsonrpc: "2.0",
      error: { code: -32601, message: "Method not found" },
      id: body.id ?? null,
    });
  });

  await app.listen({ port, host: "127.0.0.1" });

  return {
    app,
    close: async () => {
      await app.close();
    },
  };
}

describe("MCP Hub Mode", () => {
  let db: Database.Database;
  let sessionId: string;
  let mockServer1: { app: FastifyInstance; close: () => Promise<void> };
  let mockServer2: { app: FastifyInstance; close: () => Promise<void> };

  beforeEach(async () => {
    // Create in-memory database with migrations
    db = openMemoryDatabase();
    const migrationsDir = join(
      __dirname,
      "..",
      "..",
      "..",
      "core",
      "migrations"
    );
    runMigrations(db, migrationsDir);

    // Create session
    sessionId = "test-session-hub";
    db.prepare(
      "INSERT INTO sessions (id, started_at, status, created_at) VALUES (?, datetime('now'), ?, datetime('now'))"
    ).run(sessionId, "active");

    // Start mock MCP servers
    mockServer1 = await createMockMcpServer(9991, [
      { name: "echo", description: "Echo tool" },
      { name: "uppercase", description: "Uppercase tool" },
    ]);

    mockServer2 = await createMockMcpServer(9992, [
      { name: "reverse", description: "Reverse tool" },
      { name: "lowercase", description: "Lowercase tool" },
    ]);
  });

  afterEach(async () => {
    if (mockServer1) await mockServer1.close();
    if (mockServer2) await mockServer2.close();
    if (db) db.close();
  });

  it("aggregates tools/list from multiple providers with namespacing", async () => {
    const config = loadConfig();
    const { app, close } = await createMcpProxy({
      db,
      config: {
        ...config,
        // Override providers path for test
        mcpProxyPort: 19991,
      },
      sessionId,
    });

    // Override providers path by directly writing to default location
    writeProvidersFile(
      {
        version: 1,
        providers: [
          { id: "server1", type: "http", url: "http://127.0.0.1:9991/" },
          { id: "server2", type: "http", url: "http://127.0.0.1:9992/" },
        ],
      },
      getDefaultProvidersPath()
    );

    try {
      await app.listen({ port: 19991, host: "127.0.0.1" });

      // Call tools/list
      const response = await fetch("http://127.0.0.1:19991/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        result: { tools: Array<{ name: string }> };
      };
      const tools = data.result.tools;

      // Verify namespaced tool names from both providers
      expect(tools).toHaveLength(4);
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        "server1.echo",
        "server1.uppercase",
        "server2.lowercase",
        "server2.reverse",
      ]);
    } finally {
      await close();
      // Cleanup providers file
      if (fs.existsSync(getDefaultProvidersPath())) {
        fs.unlinkSync(getDefaultProvidersPath());
      }
    }
  });

  it("routes tools/call to correct provider and records with upstreamKey", async () => {
    const config = loadConfig();
    const { app, close } = await createMcpProxy({
      db,
      config: {
        ...config,
        mcpProxyPort: 19992,
      },
      sessionId,
    });

    // Write providers to default location
    writeProvidersFile(
      {
        version: 1,
        providers: [
          { id: "server1", type: "http", url: "http://127.0.0.1:9991/" },
          { id: "server2", type: "http", url: "http://127.0.0.1:9992/" },
        ],
      },
      getDefaultProvidersPath()
    );

    try {
      await app.listen({ port: 19992, host: "127.0.0.1" });

      // Call namespaced tool from server1
      const response1 = await fetch("http://127.0.0.1:19992/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "server1.echo", arguments: { text: "hello" } },
          id: 2,
        }),
      });

      expect(response1.status).toBe(200);
      const data1 = (await response1.json()) as { result: { tool: string } };
      expect(data1.result.tool).toBe("echo"); // Tool name without namespace

      // Call namespaced tool from server2
      const response2 = await fetch("http://127.0.0.1:19992/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "server2.reverse", arguments: { text: "world" } },
          id: 3,
        }),
      });

      expect(response2.status).toBe(200);
      const data2 = (await response2.json()) as { result: { tool: string } };
      expect(data2.result.tool).toBe("reverse");

      // Verify events recorded with correct upstreamKey
      const events = db
        .prepare(
          "SELECT * FROM events WHERE session_id = ? ORDER BY sequence ASC"
        )
        .all(sessionId) as Array<{
        tool_name: string;
        upstream_key: string;
        status: string;
      }>;

      expect(events).toHaveLength(2);

      // First event: server1.echo -> routed to server1
      expect(events[0]!.tool_name).toBe("echo");
      expect(events[0]!.upstream_key).toBe("server1");
      expect(events[0]!.status).toBe("success");

      // Second event: server2.reverse -> routed to server2
      expect(events[1]!.tool_name).toBe("reverse");
      expect(events[1]!.upstream_key).toBe("server2");
      expect(events[1]!.status).toBe("success");
    } finally {
      await close();
      if (fs.existsSync(getDefaultProvidersPath())) {
        fs.unlinkSync(getDefaultProvidersPath());
      }
    }
  });

  it("handles unknown provider gracefully", async () => {
    const config = loadConfig();
    const { app, close } = await createMcpProxy({
      db,
      config: {
        ...config,
        mcpProxyPort: 19993,
      },
      sessionId,
    });

    writeProvidersFile(
      {
        version: 1,
        providers: [
          { id: "server1", type: "http", url: "http://127.0.0.1:9991/" },
        ],
      },
      getDefaultProvidersPath()
    );

    try {
      await app.listen({ port: 19993, host: "127.0.0.1" });

      // Call tool with unknown provider ID
      const response = await fetch("http://127.0.0.1:19993/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "unknown.tool", arguments: {} },
          id: 4,
        }),
      });

      expect(response.status).toBe(404);
      const data = (await response.json()) as {
        error: { message: string; data: { category: string } };
      };
      expect(data.error.message).toContain("Unknown provider");
      expect(data.error.data.category).toBe("downstream_unreachable");

      // Verify error event recorded
      const events = db
        .prepare("SELECT * FROM events WHERE session_id = ?")
        .all(sessionId) as Array<{
        tool_name: string;
        upstream_key: string;
        status: string;
        error_category: string;
      }>;

      expect(events).toHaveLength(1);
      expect(events[0]!.tool_name).toBe("tool");
      expect(events[0]!.upstream_key).toBe("unknown");
      expect(events[0]!.status).toBe("error");
      expect(events[0]!.error_category).toBe("downstream_unreachable");
    } finally {
      await close();
      if (fs.existsSync(getDefaultProvidersPath())) {
        fs.unlinkSync(getDefaultProvidersPath());
      }
    }
  });

  it("handles provider failure during tools/list gracefully", async () => {
    const config = loadConfig();
    const { app, close } = await createMcpProxy({
      db,
      config: {
        ...config,
        mcpProxyPort: 19994,
        debugProxy: true, // Enable debug logging for failure test
      },
      sessionId,
    });

    // Include one unreachable provider
    writeProvidersFile(
      {
        version: 1,
        providers: [
          { id: "server1", type: "http", url: "http://127.0.0.1:9991/" },
          { id: "unreachable", type: "http", url: "http://127.0.0.1:19999/" },
        ],
      },
      getDefaultProvidersPath()
    );

    try {
      await app.listen({ port: 19994, host: "127.0.0.1" });

      // Call tools/list - should return tools from server1 only
      const response = await fetch("http://127.0.0.1:19994/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 5,
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        result: { tools: Array<{ name: string }> };
      };
      const tools = data.result.tools;

      // Should only have tools from server1 (unreachable provider omitted)
      expect(tools).toHaveLength(2);
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(["server1.echo", "server1.uppercase"]);
    } finally {
      await close();
      if (fs.existsSync(getDefaultProvidersPath())) {
        fs.unlinkSync(getDefaultProvidersPath());
      }
    }
  });
});
