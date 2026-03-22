/**
 * API client for Agent Recorder daemon REST API.
 */

import type {
  Session,
  BaseEvent,
  SessionStatus,
  SessionWithActivity,
} from "@agent-recorder/types";

export type { SessionWithActivity };

const BASE = "/api";

/**
 * Fetch JSON from the API with a 5-second timeout.
 * Note: the timeout covers connection + first byte. If the server sends
 * headers promptly but then stalls mid-body, abort() will not trigger.
 * This is acceptable for the expected payload sizes (< 1 MB).
 */
async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    // Read as text first to guard against non-JSON responses (e.g. HTML
    // error pages from a reverse proxy). Avoids cryptic SyntaxError.
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`API error: non-JSON response: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSessions(
  status?: SessionStatus
): Promise<SessionWithActivity[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString();
  return fetchJson<SessionWithActivity[]>(
    `${BASE}/sessions${qs ? `?${qs}` : ""}`
  );
}

export async function getSession(id: string): Promise<Session> {
  return fetchJson<Session>(`${BASE}/sessions/${id}`);
}

export async function getSessionEvents(
  id: string,
  after?: number,
  limit?: number
): Promise<BaseEvent[]> {
  const params = new URLSearchParams();
  if (after !== undefined) params.set("after", String(after));
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  return fetchJson<BaseEvent[]>(
    `${BASE}/sessions/${id}/events${qs ? `?${qs}` : ""}`
  );
}

export async function getEventCount(id: string): Promise<{ count: number }> {
  return fetchJson<{ count: number }>(`${BASE}/sessions/${id}/events/count`);
}
