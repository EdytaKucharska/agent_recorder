#!/usr/bin/env node
/**
 * @agent-recorder/cli
 *
 * CLI for Agent Recorder.
 * Commands: start, stop, restart, status, logs, sessions, export, install,
 *           doctor, configure, diagnose, mock-mcp
 */

import { Command } from "commander";
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

const program = new Command();

program
  .name("agent-recorder")
  .description("Local-first flight recorder for Claude Code")
  .version("0.0.1");

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
  .description("Set up ~/.agent-recorder/ and print configuration")
  .action(async () => {
    await installCommand();
  });

// Doctor command
program
  .command("doctor")
  .description("Check health and show config")
  .action(async () => {
    await doctorCommand();
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
