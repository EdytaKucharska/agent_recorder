#!/usr/bin/env node
/**
 * Agent Recorder Hook Handler
 *
 * This script is called by Claude Code hooks. It:
 * 1. Reads hook event JSON from stdin
 * 2. POSTs the event to the Agent Recorder service
 * 3. Returns appropriate exit code (0 = success, 1 = error)
 *
 * Usage in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PostToolUse": [{
 *       "matcher": "*",
 *       "hooks": [{
 *         "type": "command",
 *         "command": "agent-recorder-hook PostToolUse"
 *       }]
 *     }]
 *   }
 * }
 */

import type { HookEvent, HookOutput } from "./types.js";

/** Default service URL */
const DEFAULT_SERVICE_URL = "http://127.0.0.1:8787";

/** Read all data from stdin */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    process.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    process.stdin.on("error", reject);

    // Handle case where stdin is empty or closed immediately
    if (process.stdin.readableEnded) {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    }
  });
}

/** Parse hook event from stdin JSON */
function parseHookEvent(input: string, hookType: string): HookEvent {
  if (!input.trim()) {
    // No input provided - create minimal event
    return {
      hook_type: hookType,
      session_id: process.env.CLAUDE_SESSION_ID ?? "unknown",
    } as HookEvent;
  }

  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    return {
      ...parsed,
      hook_type: hookType,
    } as HookEvent;
  } catch {
    // If parsing fails, create minimal event
    return {
      hook_type: hookType,
      session_id: process.env.CLAUDE_SESSION_ID ?? "unknown",
    } as HookEvent;
  }
}

/** Send hook event to Agent Recorder service */
async function sendToService(
  event: HookEvent,
  serviceUrl: string
): Promise<void> {
  const url = `${serviceUrl}/api/hooks`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Service returned ${response.status}: ${text}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Main handler function */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const hookType = args[0] ?? "Unknown";
  const debug = process.env.AGENT_RECORDER_DEBUG === "1";
  const serviceUrl = process.env.AGENT_RECORDER_URL ?? DEFAULT_SERVICE_URL;

  if (debug) {
    console.error(`[agent-recorder-hook] Hook type: ${hookType}`);
    console.error(`[agent-recorder-hook] Service URL: ${serviceUrl}`);
  }

  try {
    // Read and parse stdin
    const input = await readStdin();

    if (debug) {
      console.error(`[agent-recorder-hook] Input length: ${input.length}`);
    }

    const event = parseHookEvent(input, hookType);

    if (debug) {
      console.error(
        `[agent-recorder-hook] Event: ${JSON.stringify(event).slice(0, 200)}...`
      );
    }

    // Send to service (fire and forget - don't block Claude)
    await sendToService(event, serviceUrl);

    if (debug) {
      console.error(`[agent-recorder-hook] Event sent successfully`);
    }

    // Output empty JSON to indicate success without modification
    const output: HookOutput = {};
    console.log(JSON.stringify(output));

    process.exit(0);
  } catch (error) {
    // Log error but don't block Claude - fail open
    if (debug) {
      console.error(
        `[agent-recorder-hook] Error: ${error instanceof Error ? error.message : "Unknown"}`
      );
    }

    // Still return success to not block Claude
    const output: HookOutput = {};
    console.log(JSON.stringify(output));

    process.exit(0);
  }
}

main();
