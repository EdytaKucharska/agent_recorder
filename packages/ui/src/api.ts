/**
 * API client for Agent Recorder daemon REST API.
 */

import type { Session, BaseEvent, SessionStatus } from "@agent-recorder/types";

export interface SessionWithActivity extends Session {
  lastActivityAt: string | null;
}

const BASE = "/api";

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
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
