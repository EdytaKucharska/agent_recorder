/**
 * Logs command - display daemon log file content.
 */

import { existsSync, readFileSync } from "node:fs";
import { getDaemonPaths } from "@agent-recorder/core";

export interface LogsCommandOptions {
  tail?: string;
}

/**
 * Get last N lines from a file.
 */
function tailLines(content: string, n: number): string[] {
  const lines = content.split("\n");
  // Remove trailing empty line if present
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.slice(-n);
}

export async function logsCommand(
  options: LogsCommandOptions = {}
): Promise<void> {
  const paths = getDaemonPaths();
  const tailCount = options.tail ? parseInt(options.tail, 10) : 50;

  if (!existsSync(paths.logFile)) {
    console.error(`Log file not found: ${paths.logFile}`);
    console.error("");
    console.error("The daemon may not have been started in daemon mode yet.");
    console.error("Run 'agent-recorder start --daemon' to start the daemon.");
    process.exit(1);
  }

  const content = readFileSync(paths.logFile, "utf-8");
  const lines = tailLines(content, tailCount);

  if (lines.length === 0) {
    console.log("Log file is empty.");
    return;
  }

  console.log(`Last ${lines.length} lines from ${paths.logFile}:`);
  console.log("=".repeat(60));
  console.log("");

  for (const line of lines) {
    console.log(line);
  }
}
