/**
 * createMcpServer — Instantiate and configure the Agent Recorder MCP server.
 *
 * Registers all 8 tools (5 read + 3 write) and returns the configured McpServer.
 * The caller is responsible for connecting a transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";

// Read tools
import { register as registerListSessions } from "./tools/read/list-sessions.js";
import { register as registerGetSession } from "./tools/read/get-session.js";
import { register as registerQueryTokenUsage } from "./tools/read/query-token-usage.js";
import { register as registerGetTokenBudget } from "./tools/read/get-token-budget.js";
import { register as registerListUpstreams } from "./tools/read/list-upstreams.js";

// Write tools
import { register as registerRecordEvent } from "./tools/write/record-event.js";
import { register as registerCompleteEvent } from "./tools/write/complete-event.js";
import { register as registerRecordBatch } from "./tools/write/record-batch.js";

export interface McpServerOptions {
  db: Database.Database;
  redactKeys?: string[];
  contextBudgetTokens?: number;
  rateLimits?: { read: number; write: number; batch: number };
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const server = new McpServer({
    name: "agent-recorder",
    version: "2.0.14",
  });

  // Register all read tools
  registerListSessions(server, opts.db, opts);
  registerGetSession(server, opts.db, opts);
  registerQueryTokenUsage(server, opts.db, opts);
  registerGetTokenBudget(server, opts.db, opts);
  registerListUpstreams(server, opts.db, opts);

  // Register all write tools
  registerRecordEvent(server, opts.db, opts);
  registerCompleteEvent(server, opts.db, opts);
  registerRecordBatch(server, opts.db, opts);

  return server;
}
