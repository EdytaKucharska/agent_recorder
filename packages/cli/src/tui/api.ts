/**
 * TUI API client for fetching sessions and events.
 */

import type { Session, BaseEvent } from "@agent-recorder/core";

/**
 * Fetch all sessions from the API.
 */
export async function fetchSessions(baseUrl: string): Promise<Session[]> {
  try {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as Session[];
  } catch {
    return [];
  }
}

/**
 * Fetch a single session by ID.
 */
export async function fetchSession(
  baseUrl: string,
  id: string
): Promise<Session | null> {
  try {
    const response = await fetch(`${baseUrl}/api/sessions/${id}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Session;
  } catch {
    return null;
  }
}

/**
 * Fetch events for a session with optional pagination.
 */
export async function fetchEvents(
  baseUrl: string,
  sessionId: string,
  options?: { after?: number; limit?: number }
): Promise<BaseEvent[]> {
  try {
    const params = new URLSearchParams();
    if (options?.after !== undefined) {
      params.set("after", String(options.after));
    }
    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }

    const url = `${baseUrl}/api/sessions/${sessionId}/events${
      params.toString() ? `?${params.toString()}` : ""
    }`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as BaseEvent[];
  } catch {
    return [];
  }
}

/**
 * Fetch event count for a session.
 */
export async function fetchEventCount(
  baseUrl: string,
  sessionId: string
): Promise<number> {
  try {
    const response = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/events/count`,
      {
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!response.ok) {
      return 0;
    }
    const data = (await response.json()) as { count: number };
    return data.count;
  } catch {
    return 0;
  }
}

/**
 * Check if the daemon is running by hitting the health endpoint.
 */
export async function checkDaemonHealth(
  baseUrl: string
): Promise<{ running: boolean; error?: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      return { running: true };
    }
    return { running: false, error: `HTTP ${response.status}` };
  } catch (err) {
    const error = err as { cause?: { code?: string }; name?: string };
    if (error.cause?.code === "ECONNREFUSED") {
      return { running: false, error: "Daemon not running" };
    }
    if (error.name === "TimeoutError") {
      return { running: false, error: "Connection timeout" };
    }
    return { running: false, error: "Connection failed" };
  }
}
