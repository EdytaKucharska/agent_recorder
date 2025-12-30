/**
 * Mock MCP Server - minimal MCP server for end-to-end testing.
 * Implements JSON-RPC 2.0 over Streamable HTTP.
 */

import * as http from "node:http";

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Echo tool input schema.
 */
const echoToolSchema = {
  name: "echo",
  description: "Echoes back the provided text",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to echo back",
      },
    },
    required: ["text"],
  },
};

/**
 * Handle JSON-RPC request.
 */
function handleRpcRequest(request: JsonRpcRequest): JsonRpcResponse {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "agent-recorder-mock-mcp",
            version: "1.0.0",
          },
        },
      };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [echoToolSchema],
        },
      };

    case "tools/call": {
      const toolName = params?.name as string | undefined;
      const args = params?.arguments as Record<string, unknown> | undefined;

      if (toolName !== "echo") {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: `Unknown tool: ${toolName}`,
          },
        };
      }

      const text = args?.text as string | undefined;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: text ?? "",
            },
          ],
        },
      };
    }

    case "notifications/initialized":
      // Notification - no response needed but we return success
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

/**
 * Create and start mock MCP server.
 */
function startMockServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // Only accept POST
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const request = JSON.parse(body) as JsonRpcRequest;

        // Validate JSON-RPC format
        if (request.jsonrpc !== "2.0" || !request.method) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id ?? null,
              error: { code: -32600, message: "Invalid Request" },
            })
          );
          return;
        }

        const response = handleRpcRequest(request);

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(response));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          })
        );
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Mock MCP server listening on http://127.0.0.1:${port}/`);
    console.log("");
    console.log("Available tools:");
    console.log("  - echo(text: string): Echoes back the provided text");
    console.log("");
    console.log("Press Ctrl+C to stop.");
  });

  return server;
}

export interface MockMcpOptions {
  port?: string;
  printEnv?: boolean;
}

export async function mockMcpCommand(
  options: MockMcpOptions = {}
): Promise<void> {
  const port = parseInt(options.port ?? "9999", 10);

  if (options.printEnv) {
    console.log(`export AR_DOWNSTREAM_MCP_URL="http://127.0.0.1:${port}/"`);
    return;
  }

  // Validate port
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${options.port}`);
    process.exit(1);
  }

  const server = startMockServer(port);

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down mock MCP server...");
    server.close(() => {
      console.log("Server stopped.");
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
