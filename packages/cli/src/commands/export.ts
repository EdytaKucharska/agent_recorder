/**
 * Export command - export session events to JSON or JSONL format.
 */

import { writeFileSync } from "node:fs";
import { loadConfig, type Session, type BaseEvent } from "@agent-recorder/core";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface ExportCommandOptions {
  format?: string;
  out?: string;
}

/**
 * Export a session's events to JSON or JSONL format.
 */
export async function exportCommand(
  id: string,
  options: ExportCommandOptions
): Promise<void> {
  const config = loadConfig();
  const baseUrl = `http://127.0.0.1:${config.listenPort}`;
  const format = options.format ?? "jsonl";

  // Validate format
  if (format !== "json" && format !== "jsonl") {
    console.error('Invalid format. Use "json" or "jsonl".');
    process.exit(1);
  }

  try {
    // Fetch session and events
    const session = await fetchJson<Session>(`${baseUrl}/api/sessions/${id}`);
    const events = await fetchJson<BaseEvent[]>(
      `${baseUrl}/api/sessions/${id}/events`
    );

    let output: string;

    if (format === "jsonl") {
      // JSONL format: each line is an object with "type" field
      const lines: string[] = [];
      lines.push(JSON.stringify({ type: "session", ...session }));
      for (const event of events) {
        lines.push(JSON.stringify({ type: "event", ...event }));
      }
      output = lines.join("\n") + "\n";
    } else {
      // JSON format: object with session and events arrays
      output = JSON.stringify({ session, events }, null, 2) + "\n";
    }

    if (options.out) {
      writeFileSync(options.out, output);
      console.log(`Exported to ${options.out}`);
    } else {
      process.stdout.write(output);
    }
  } catch {
    console.error(`Failed to export session: ${id}`);
    process.exit(1);
  }
}
