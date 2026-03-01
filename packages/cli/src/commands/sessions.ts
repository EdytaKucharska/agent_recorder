/**
 * Sessions commands - list, show, current, tail, view, stats, grep, summarize.
 */

import {
  getActualListenPort,
  type Session,
  type BaseEvent,
} from "@agent-recorder/core";
import {
  computeSessionSummary,
  formatStatsText,
  formatConciseSummary,
} from "../analytics/session-analytics.js";

interface SessionWithCount extends Session {
  eventCount: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function getEventCount(
  baseUrl: string,
  sessionId: string
): Promise<number> {
  try {
    const result = await fetchJson<{ count: number }>(
      `${baseUrl}/api/sessions/${sessionId}/events/count`
    );
    return result.count;
  } catch {
    return 0;
  }
}

function formatTable(sessions: SessionWithCount[]): void {
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  // Header
  console.log(
    "ID".padEnd(38) + "STATUS".padEnd(12) + "STARTED".padEnd(25) + "EVENTS"
  );
  console.log("-".repeat(80));

  // Rows
  for (const session of sessions) {
    const id = session.id.padEnd(38);
    const status = session.status.padEnd(12);
    const started = session.startedAt.padEnd(25);
    const events = String(session.eventCount);
    console.log(`${id}${status}${started}${events}`);
  }
}

export async function sessionsListCommand(options: {
  status?: string;
}): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;

  try {
    // Fetch sessions
    let url = `${baseUrl}/api/sessions`;
    if (options.status) {
      url += `?status=${options.status}`;
    }

    const sessions = await fetchJson<Session[]>(url);

    // Fetch event counts for each session
    const sessionsWithCounts: SessionWithCount[] = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        eventCount: await getEventCount(baseUrl, session.id),
      }))
    );

    formatTable(sessionsWithCounts);
  } catch {
    console.error("Failed to fetch sessions. Is the daemon running?");
    process.exit(1);
  }
}

export async function sessionsShowCommand(id: string): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;

  try {
    // Fetch session details
    const session = await fetchJson<Session>(`${baseUrl}/api/sessions/${id}`);

    // Fetch event count
    const eventCount = await getEventCount(baseUrl, id);

    console.log("Session Details");
    console.log("===============");
    console.log(`ID:       ${session.id}`);
    console.log(`Status:   ${session.status}`);
    console.log(`Started:  ${session.startedAt}`);
    console.log(`Ended:    ${session.endedAt ?? "N/A"}`);
    console.log(`Events:   ${eventCount}`);
  } catch {
    console.error(`Session not found: ${id}`);
    process.exit(1);
  }
}

/**
 * Get the current active session ID.
 */
export async function sessionsCurrentCommand(): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;

  try {
    const current = await fetchJson<{
      id: string;
      status: string;
      startedAt: string;
    }>(`${baseUrl}/api/sessions/current`);
    console.log(current.id);
  } catch {
    console.error("No active session (daemon may not be running)");
    process.exit(1);
  }
}

/**
 * Format and print a single event for tail output.
 */
function printEvent(event: BaseEvent): void {
  const duration =
    event.endedAt && event.startedAt
      ? new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime()
      : null;
  const durationStr = duration !== null ? `${duration}ms` : "...";
  const name = event.toolName ?? event.skillName ?? "-";
  console.log(
    `[${event.sequence}] ${event.eventType} ${name} ${event.status} ${durationStr}`
  );
}

export interface SessionsTailOptions {
  interval?: string;
  n?: string;
}

/**
 * Tail session events (like tail -f).
 * Runs indefinitely until Ctrl+C.
 */
export async function sessionsTailCommand(
  id: string,
  options: SessionsTailOptions
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;
  const intervalMs = parseInt(options.interval ?? "1000", 10);
  const initialLimit = parseInt(options.n ?? "50", 10);

  let lastSequence = 0;

  console.log(`Tailing session ${id} (Ctrl+C to stop)...\n`);

  /**
   * Fetch events after lastSequence.
   * For initial fetch, we get last N events by fetching all and slicing.
   */
  const fetchEvents = async (
    after: number,
    limit: number
  ): Promise<BaseEvent[]> => {
    const url = `${baseUrl}/api/sessions/${id}/events?after=${after}&limit=${limit}`;
    try {
      return await fetchJson<BaseEvent[]>(url);
    } catch {
      return [];
    }
  };

  // Initial fetch: get last N events
  const initialEvents = await fetchEvents(0, 1000); // Get up to 1000 events
  const startIndex = Math.max(0, initialEvents.length - initialLimit);
  const recentEvents = initialEvents.slice(startIndex);

  for (const event of recentEvents) {
    printEvent(event);
    lastSequence = Math.max(lastSequence, event.sequence);
  }

  // Poll for new events
  const poll = async () => {
    const events = await fetchEvents(lastSequence, 200);
    for (const event of events) {
      printEvent(event);
      lastSequence = Math.max(lastSequence, event.sequence);
    }
  };

  const timer = setInterval(poll, intervalMs);

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\nStopped tailing.");
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {
    // Never resolves - runs until SIGINT
  });
}

/**
 * Print a detailed event row for view/grep output.
 */
function printEventDetailed(event: BaseEvent): void {
  const duration =
    event.endedAt && event.startedAt
      ? new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime()
      : null;
  const durationStr = duration !== null ? `${duration}ms` : "...";
  const name = event.toolName ?? event.skillName ?? "-";
  const errorInfo = event.errorCategory ? ` [${event.errorCategory}]` : "";

  console.log(
    `[${String(event.sequence).padStart(4)}] ${event.eventType.padEnd(12)} ${name.padEnd(30)} ${event.status.padEnd(8)} ${durationStr.padEnd(10)}${errorInfo}`
  );
}

export interface SessionsViewOptions {
  tail?: string;
  follow?: boolean;
  interval?: string;
}

/**
 * View session events with optional tail and follow mode.
 */
export async function sessionsViewCommand(
  id: string,
  options: SessionsViewOptions
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;
  const tailCount = options.tail ? parseInt(options.tail, 10) : 200;
  const intervalMs = parseInt(options.interval ?? "1000", 10);

  try {
    // Fetch session info
    const session = await fetchJson<Session>(`${baseUrl}/api/sessions/${id}`);

    // Fetch all events
    const events = await fetchJson<BaseEvent[]>(
      `${baseUrl}/api/sessions/${id}/events`
    );

    // Compute summary for header
    const summary = computeSessionSummary(events);

    // Print header
    console.log("Session View");
    console.log("=".repeat(80));
    console.log(`ID: ${session.id}`);
    console.log(`Status: ${session.status}`);
    console.log(`Started: ${session.startedAt}`);
    console.log(`Ended: ${session.endedAt ?? "N/A"}`);
    console.log("");
    console.log(
      `Events: ${summary.totalEvents} | Success: ${summary.successCount} | Error: ${summary.errorCount} | Timeout: ${summary.timeoutCount}`
    );
    console.log(
      `Top Tools: ${summary.topTools.map((t) => `${t.name}(${t.count})`).join(", ") || "none"}`
    );
    console.log("=".repeat(80));
    console.log("");

    // Print column header
    console.log(
      `${"SEQ".padStart(6)} ${"TYPE".padEnd(12)} ${"NAME".padEnd(30)} ${"STATUS".padEnd(8)} ${"DURATION".padEnd(10)} ERROR`
    );
    console.log("-".repeat(80));

    // Show tail events
    const startIndex = Math.max(0, events.length - tailCount);
    const displayEvents = events.slice(startIndex);

    for (const event of displayEvents) {
      printEventDetailed(event);
    }

    // If follow mode, poll for new events
    if (options.follow) {
      let lastSequence =
        events.length > 0 ? events[events.length - 1]!.sequence : 0;

      console.log("\n-- Following new events (Ctrl+C to stop) --\n");

      const poll = async () => {
        try {
          const newEvents = await fetchJson<BaseEvent[]>(
            `${baseUrl}/api/sessions/${id}/events?after=${lastSequence}&limit=200`
          );
          for (const event of newEvents) {
            printEventDetailed(event);
            lastSequence = Math.max(lastSequence, event.sequence);
          }
        } catch {
          // Silently ignore polling errors
        }
      };

      const timer = setInterval(poll, intervalMs);

      process.on("SIGINT", () => {
        clearInterval(timer);
        console.log("\nStopped following.");
        process.exit(0);
      });

      await new Promise(() => {});
    }
  } catch {
    console.error(`Failed to view session: ${id}`);
    process.exit(1);
  }
}

/**
 * Show session statistics.
 */
export async function sessionsStatsCommand(id: string): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;

  try {
    const events = await fetchJson<BaseEvent[]>(
      `${baseUrl}/api/sessions/${id}/events`
    );

    if (events.length === 0) {
      console.log("No events in this session.");
      return;
    }

    const summary = computeSessionSummary(events);
    console.log(formatStatsText(summary));
  } catch {
    console.error(`Failed to get stats for session: ${id}`);
    process.exit(1);
  }
}

export interface SessionsGrepOptions {
  tool?: string;
  status?: string;
  error?: string;
  sinceSeq?: string;
  json?: boolean;
}

/**
 * Search/filter session events.
 */
export async function sessionsGrepCommand(
  id: string,
  options: SessionsGrepOptions
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;

  try {
    // Fetch all events
    const events = await fetchJson<BaseEvent[]>(
      `${baseUrl}/api/sessions/${id}/events`
    );

    // Filter client-side (per spec: no new REST endpoints for grep)
    let filtered = events;

    if (options.tool) {
      filtered = filtered.filter((e) => e.toolName === options.tool);
    }
    if (options.status) {
      filtered = filtered.filter((e) => e.status === options.status);
    }
    if (options.error) {
      filtered = filtered.filter((e) => e.errorCategory === options.error);
    }
    if (options.sinceSeq) {
      const sinceSeq = parseInt(options.sinceSeq, 10);
      filtered = filtered.filter((e) => e.sequence > sinceSeq);
    }

    if (options.json) {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      if (filtered.length === 0) {
        console.log("No matching events found.");
        return;
      }

      // Print header
      console.log(
        `${"SEQ".padStart(6)} ${"TYPE".padEnd(12)} ${"NAME".padEnd(30)} ${"STATUS".padEnd(8)} ${"DURATION".padEnd(10)} ERROR`
      );
      console.log("-".repeat(80));

      for (const event of filtered) {
        printEventDetailed(event);
      }

      console.log("");
      console.log(`Found ${filtered.length} matching event(s).`);
    }
  } catch {
    console.error(`Failed to search session: ${id}`);
    process.exit(1);
  }
}

export interface SessionsSummarizeOptions {
  format?: string;
}

/**
 * Summarize session with safe metadata-only summary.
 */
export async function sessionsSummarizeCommand(
  id: string,
  options: SessionsSummarizeOptions
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;
  const format = options.format ?? "text";

  try {
    const session = await fetchJson<Session>(`${baseUrl}/api/sessions/${id}`);
    const events = await fetchJson<BaseEvent[]>(
      `${baseUrl}/api/sessions/${id}/events`
    );
    const summary = computeSessionSummary(events);

    if (format === "json") {
      console.log(JSON.stringify({ session, summary }, null, 2));
    } else {
      console.log(`Session: ${session.id}`);
      console.log(`Status: ${session.status}`);
      console.log(`Started: ${session.startedAt}`);
      console.log(`Ended: ${session.endedAt ?? "N/A"}`);
      console.log("");
      console.log(formatConciseSummary(events, summary));
    }
  } catch {
    console.error(`Failed to summarize session: ${id}`);
    process.exit(1);
  }
}
