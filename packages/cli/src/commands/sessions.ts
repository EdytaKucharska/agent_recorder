/**
 * Sessions commands - list and show session details.
 */

import { loadConfig, type Session, type SessionStatus } from "@agent-recorder/core";

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

async function getEventCount(baseUrl: string, sessionId: string): Promise<number> {
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
    "ID".padEnd(38) +
      "STATUS".padEnd(12) +
      "STARTED".padEnd(25) +
      "EVENTS"
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
  const config = loadConfig();
  const baseUrl = `http://127.0.0.1:${config.listenPort}`;

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
  const config = loadConfig();
  const baseUrl = `http://127.0.0.1:${config.listenPort}`;

  try {
    // Fetch session details
    const session = await fetchJson<Session>(
      `${baseUrl}/api/sessions/${id}`
    );

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
