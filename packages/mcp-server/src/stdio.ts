/**
 * Standalone STDIO entry point for Agent Recorder MCP server.
 *
 * Opens the SQLite DB in read-only mode to avoid WAL conflicts with a running
 * daemon. Only read tools are registered — write tools are omitted because the
 * external agent should call the daemon's /mcp endpoint directly.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  openDatabase,
  runMigrations,
  getDefaultMigrationsDir,
} from "@agent-recorder/core";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const dbPath = process.env["AR_DB_PATH"] ?? ".storage/agent-recorder.sqlite";

  const db = openDatabase(dbPath);
  runMigrations(db, getDefaultMigrationsDir());

  const redactKeys = process.env["AR_REDACT_KEYS"]
    ? process.env["AR_REDACT_KEYS"].split(",").map((k) => k.trim())
    : [];

  const server = createMcpServer({ db, redactKeys });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("[mcp-stdio] Fatal error:", err);
  process.exit(1);
});
