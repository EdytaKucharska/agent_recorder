#!/usr/bin/env node
/**
 * STDIO Proxy CLI
 *
 * Usage:
 *   agent-recorder-proxy [options] -- <command> [args...]
 *
 * Examples:
 *   # Basic usage
 *   agent-recorder-proxy -- npx -y @modelcontextprotocol/server-github
 *
 *   # With file output
 *   agent-recorder-proxy --output ./logs/github.jsonl -- npx -y @modelcontextprotocol/server-github
 *
 *   # With remote endpoint
 *   agent-recorder-proxy --endpoint http://localhost:8787/api/stdio -- npx -y @modelcontextprotocol/server-github
 *
 *   # Debug mode
 *   agent-recorder-proxy --debug -- npx -y @modelcontextprotocol/server-github
 */

import { randomUUID } from "node:crypto";
import { StdioProxy } from "./proxy.js";
import type { ProxyOptions } from "./types.js";

/** Parse command line arguments */
function parseArgs(argv: string[]): {
  options: Partial<ProxyOptions>;
  command: string[];
} {
  const options: Partial<ProxyOptions> = {};
  const command: string[] = [];
  let foundSeparator = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (foundSeparator) {
      command.push(arg);
      continue;
    }

    if (arg === "--") {
      foundSeparator = true;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      options.outputFile = argv[++i];
    } else if (arg === "--endpoint" || arg === "-e") {
      options.endpoint = argv[++i];
    } else if (arg === "--session" || arg === "-s") {
      options.sessionId = argv[++i];
    } else if (arg === "--cwd" || arg === "-c") {
      options.cwd = argv[++i];
    } else if (arg === "--debug" || arg === "-d") {
      options.debug = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      console.log("agent-recorder-proxy 2.0.0");
      process.exit(0);
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      console.error("Use --help for usage information");
      process.exit(1);
    } else {
      // Assume rest is command
      command.push(arg);
      for (let j = i + 1; j < argv.length; j++) {
        command.push(argv[j]!);
      }
      break;
    }
  }

  return { options, command };
}

function printHelp(): void {
  console.log(`
agent-recorder-proxy - STDIO proxy for MCP server observability

USAGE:
  agent-recorder-proxy [OPTIONS] -- <command> [args...]
  agent-recorder-proxy [OPTIONS] <command> [args...]

OPTIONS:
  -o, --output <file>     Write JSONL logs to file
  -e, --endpoint <url>    POST telemetry to HTTP endpoint
  -s, --session <id>      Session ID for correlation (auto-generated if not set)
  -c, --cwd <dir>         Working directory for child process
  -d, --debug             Enable debug logging to stderr
  -h, --help              Show this help message
  -v, --version           Show version

EXAMPLES:
  # Basic usage - wrap a GitHub MCP server
  agent-recorder-proxy -- npx -y @modelcontextprotocol/server-github

  # Log to file
  agent-recorder-proxy -o ./mcp.jsonl -- npx -y @modelcontextprotocol/server-filesystem /tmp

  # Send telemetry to Agent Recorder service
  agent-recorder-proxy -e http://localhost:8787/api/stdio -- npx -y @modelcontextprotocol/server-github

  # Debug mode (logs to stderr)
  agent-recorder-proxy --debug -- python -m mcp_server_custom

ENVIRONMENT:
  All environment variables from the parent process are passed to the child.
  This includes API keys (GITHUB_TOKEN, etc.) and PATH.

MCP CLIENT CONFIGURATION:
  Before (direct):
    {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }

  After (with proxy):
    {
      "command": "npx",
      "args": ["-y", "agent-recorder-proxy", "--", "npx", "-y", "@modelcontextprotocol/server-github"]
    }

For more information, visit: https://github.com/EdytaKucharska/agent_recorder
`);
}

async function main(): Promise<void> {
  const { options, command } = parseArgs(process.argv.slice(2));

  if (command.length === 0) {
    console.error("Error: No command specified");
    console.error(
      "Usage: agent-recorder-proxy [options] -- <command> [args...]"
    );
    console.error("Use --help for more information");
    process.exit(1);
  }

  // Extract command and args
  const [cmd, ...args] = command;

  // Build proxy options
  const proxyOptions: ProxyOptions = {
    command: cmd!,
    args,
    cwd: options.cwd,
    outputFile: options.outputFile,
    endpoint: options.endpoint,
    sessionId: options.sessionId ?? randomUUID(),
    debug: options.debug ?? false,
  };

  // Create and start proxy
  const proxy = new StdioProxy(proxyOptions);

  try {
    await proxy.start();
  } catch (error) {
    console.error(
      `Failed to start proxy: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    process.exit(1);
  }
}

main();
