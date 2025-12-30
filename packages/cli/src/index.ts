#!/usr/bin/env node
/**
 * @agent-recorder/cli
 *
 * CLI for Agent Recorder.
 * Commands: start, status, sessions, doctor
 */

import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import {
  sessionsListCommand,
  sessionsShowCommand,
} from "./commands/sessions.js";
import { doctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("agent-recorder")
  .description("Local-first flight recorder for Claude Code")
  .version("0.0.1");

program
  .command("start")
  .description("Start the daemon in foreground")
  .action(async () => {
    await startCommand();
  });

program
  .command("status")
  .description("Check if daemon is running")
  .action(async () => {
    await statusCommand();
  });

// Sessions subcommand group
const sessions = program.command("sessions").description("Manage sessions");

sessions
  .command("list")
  .description("List all sessions")
  .option("-s, --status <status>", "Filter by status (active|completed|error|cancelled)")
  .action(async (options) => {
    await sessionsListCommand(options);
  });

sessions
  .command("show <id>")
  .description("Show session details")
  .action(async (id) => {
    await sessionsShowCommand(id);
  });

// Doctor command
program
  .command("doctor")
  .description("Check health and show config")
  .action(async () => {
    await doctorCommand();
  });

program.parse();
