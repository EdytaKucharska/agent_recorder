#!/usr/bin/env node
/**
 * @agent-recorder/cli
 *
 * CLI for Agent Recorder.
 * Commands: start, stop, restart, status, logs, sessions, export, install,
 *           doctor, configure, diagnose, mock-mcp
 */

import { Command } from "commander";
import { createRequire } from "module";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { restartCommand } from "./commands/restart.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import {
  sessionsListCommand,
  sessionsShowCommand,
  sessionsCurrentCommand,
  sessionsTailCommand,
  sessionsViewCommand,
  sessionsStatsCommand,
  sessionsGrepCommand,
  sessionsSummarizeCommand,
} from "./commands/sessions.js";
import { exportCommand } from "./commands/export.js";
import { installCommand } from "./commands/install.js";
import { doctorCommand } from "./commands/doctor.js";
import {
  configureClaudeCommand,
  configureShowCommand,
} from "./commands/configure.js";
import { configureWrapCommand } from "./commands/configure-wrap.js";
import { diagnoseMcpCommand } from "./commands/diagnose.js";
import { mockMcpCommand } from "./commands/mock-mcp.js";
import { tuiCommand } from "./commands/tui.js";
import { discoverCommand } from "./commands/discover.js";
import { addCommand, removeCommand, listCommand } from "./commands/add.js";
import {
  upstreamAddCommand,
  upstreamRemoveCommand,
  upstreamListCommand,
} from "./commands/upstream.js";
import {
  hooksInstallCommand,
  hooksUninstallCommand,
  hooksStatusCommand,
} from "./commands/hooks.js";

// Read version from package.json dynamically
// In dev: ../package.json (from dist/ to package root)
// In bundled npm package: ./package.json (same directory)
function getVersion(): string {
  const require = createRequire(import.meta.url);
  try {
    // Try bundled path first (./package.json)
    const pkg = require("./package.json") as { version: string };
    return pkg.version;
  } catch {
    // Fall back to dev path (../package.json)
    const pkg = require("../package.json") as { version: string };
    return pkg.version;
  }
}
const version = getVersion();

const program = new Command();

program
  .name("agent-recorder")
  .description("Local-first flight recorder for Claude Code")
  .version(version);

program
  .command("start")
  .description("Start the daemon")
  .option("-e, --env-file <path>", "Load environment variables from file")
  .option("-d, --daemon", "Run in background (daemon mode)")
  .option("-f, --force", "Force restart if already running")
  .action(async (options) => {
    await startCommand(options);
  });

program
  .command("stop")
  .description("Stop the daemon")
  .option("-f, --force", "Force kill if not responding")
  .action(async (options) => {
    await stopCommand(options);
  });

program
  .command("restart")
  .description("Restart the daemon")
  .option("-e, --env-file <path>", "Load environment variables from file")
  .option("-f, --force", "Force kill if not responding")
  .action(async (options) => {
    await restartCommand(options);
  });

program
  .command("status")
  .description("Show daemon status")
  .action(async () => {
    await statusCommand();
  });

program
  .command("logs")
  .description("Show daemon logs")
  .option("-t, --tail <n>", "Show last N lines (default 50)")
  .action(async (options) => {
    await logsCommand(options);
  });

// Sessions subcommand group
const sessions = program.command("sessions").description("Manage sessions");

sessions
  .command("list")
  .description("List all sessions")
  .option(
    "-s, --status <status>",
    "Filter by status (active|completed|error|cancelled)"
  )
  .action(async (options) => {
    await sessionsListCommand(options);
  });

sessions
  .command("show <id>")
  .description("Show session details")
  .action(async (id) => {
    await sessionsShowCommand(id);
  });

sessions
  .command("current")
  .description("Get current active session ID")
  .action(async () => {
    await sessionsCurrentCommand();
  });

sessions
  .command("tail <id>")
  .description("Tail session events (like tail -f)")
  .option("-i, --interval <ms>", "Poll interval in milliseconds", "1000")
  .option("-n, --n <count>", "Number of recent events to show initially", "50")
  .action(async (id, options) => {
    await sessionsTailCommand(id, options);
  });

sessions
  .command("view <id>")
  .description("View session events with header summary")
  .option("-t, --tail <n>", "Show last N events (default 200)")
  .option("-f, --follow", "Follow new events (like tail -f)")
  .option("-i, --interval <ms>", "Poll interval for follow mode", "1000")
  .action(async (id, options) => {
    await sessionsViewCommand(id, options);
  });

sessions
  .command("stats <id>")
  .description("Show session statistics")
  .action(async (id) => {
    await sessionsStatsCommand(id);
  });

sessions
  .command("grep <id>")
  .description("Search/filter session events")
  .option("--tool <name>", "Filter by tool name")
  .option(
    "--status <status>",
    "Filter by status (success|error|timeout|running|cancelled)"
  )
  .option("--error <category>", "Filter by error category")
  .option("--since-seq <n>", "Only events after sequence N")
  .option("--json", "Output as JSON")
  .action(async (id, options) => {
    await sessionsGrepCommand(id, options);
  });

sessions
  .command("summarize <id>")
  .description("Summarize session (safe metadata-only)")
  .option("-f, --format <format>", "Output format: text or json", "text")
  .action(async (id, options) => {
    await sessionsSummarizeCommand(id, options);
  });

// Export command
program
  .command("export <id>")
  .description("Export session events to JSON or JSONL")
  .option("-f, --format <format>", "Output format: json or jsonl", "jsonl")
  .option("-o, --out <path>", "Output file path (stdout if not specified)")
  .action(async (id, options) => {
    await exportCommand(id, options);
  });

// Install command
program
  .command("install")
  .description(
    "Set up ~/.agent-recorder/ and configure Claude Code (with hubify mode)"
  )
  .option("--no-configure", "Skip automatic Claude Code configuration")
  .action(async (options: { noConfigure?: boolean }) => {
    const installOpts = options.noConfigure
      ? { noConfigure: options.noConfigure }
      : {};
    await installCommand(installOpts);
  });

// Doctor command
program
  .command("doctor")
  .description("Check health and show config")
  .action(async () => {
    await doctorCommand();
  });

// Hooks command group (v2 - recommended)
const hooks = program
  .command("hooks")
  .description("Manage Claude Code hooks (v2 - recommended)");

hooks
  .command("install")
  .description("Install Agent Recorder hooks into Claude Code")
  .action(async () => {
    await hooksInstallCommand();
  });

hooks
  .command("uninstall")
  .description("Remove Agent Recorder hooks from Claude Code")
  .action(async () => {
    await hooksUninstallCommand();
  });

hooks
  .command("status")
  .description("Show hook installation status")
  .action(async () => {
    await hooksStatusCommand();
  });

// Provider management commands (simple hub mode configuration)
program
  .command("add <name> <url>")
  .description("Add an MCP provider to hub mode")
  .option("-f, --force", "Overwrite if provider exists")
  .action(async (name, url, options) => {
    await addCommand(name, url, options);
  });

program
  .command("remove <name>")
  .description("Remove an MCP provider from hub mode")
  .action(async (name) => {
    await removeCommand(name);
  });

program
  .command("list")
  .description("List all configured MCP providers")
  .action(async () => {
    await listCommand();
  });

// Upstream management commands (router mode with auth headers support)
const upstream = program
  .command("upstream")
  .description("Manage upstreams for router mode (supports auth headers)");

upstream
  .command("add <name> <url>")
  .description("Add an upstream with optional auth headers")
  .option("-f, --force", "Overwrite if upstream exists")
  .option(
    "-H, --header <header>",
    "Add header (e.g., 'Authorization: Bearer xxx')",
    (value: string, previous: string[]) => previous.concat([value]),
    [] as string[]
  )
  .action(async (name, url, options) => {
    await upstreamAddCommand(name, url, options);
  });

upstream
  .command("remove <name>")
  .description("Remove an upstream")
  .action(async (name) => {
    await upstreamRemoveCommand(name);
  });

upstream
  .command("list")
  .description("List all configured upstreams")
  .action(async () => {
    await upstreamListCommand();
  });

// Discover command
program
  .command("discover")
  .description(
    "Discover MCP servers from all config sources (Claude, Cursor, VS Code, project)"
  )
  .option("--json", "Output as JSON")
  .option("-v, --verbose", "Show additional details")
  .action(async (options) => {
    await discoverCommand(options);
  });

// TUI command
program
  .command("tui")
  .description("Interactive session explorer")
  .action(async () => {
    await tuiCommand();
  });

// Configure command group
const configure = program
  .command("configure")
  .description("Configure integrations");

configure
  .command("claude")
  .description("Configure Claude Code MCP settings")
  .option("--path <path>", "Custom config file path")
  .option("--legacy", "Use legacy config path (~/.config/claude/mcp.json)")
  .option("--dry-run", "Show changes without writing")
  .action(async (options) => {
    await configureClaudeCommand(options);
  });

configure
  .command("show")
  .description("Show current Claude Code configuration")
  .action(async () => {
    await configureShowCommand();
  });

configure
  .command("wrap")
  .description("Wrap Claude Code MCP servers with Agent Recorder proxy")
  .option("--all", "Wrap all URL-based MCP servers (default)", true)
  .option("--only <servers>", "Wrap only specific servers (comma-separated)")
  .option("--dry-run", "Show changes without writing")
  .option("--undo", "Restore from backup")
  .action(async (options) => {
    await configureWrapCommand(options);
  });

// Diagnose command group
const diagnose = program.command("diagnose").description("Diagnostic tools");

diagnose
  .command("mcp")
  .description("Run MCP proxy diagnostics")
  .action(async () => {
    await diagnoseMcpCommand();
  });

// Mock MCP server
program
  .command("mock-mcp")
  .description("Start a mock MCP server for testing")
  .option("-p, --port <port>", "Port to listen on", "9999")
  .option("--print-env", "Print export command and exit")
  .action(async (options) => {
    await mockMcpCommand(options);
  });

program.parse();
