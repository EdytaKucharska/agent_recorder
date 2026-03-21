import React, { useEffect, useState } from "react";
import type { SessionWithActivity } from "../api.js";
import { getSessions } from "../api.js";

interface SessionListProps {
  onSelect: (sessionId: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e",
  completed: "#6b7280",
  error: "#ef4444",
  cancelled: "#f59e0b",
};

export function SessionList({ onSelect }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionWithActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getSessions();
        if (!cancelled) {
          setSessions(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
      }
    }

    load();
    // Refresh every 5 seconds
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) return <div className="loading">Loading sessions...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (sessions.length === 0)
    return <div className="empty">No sessions recorded yet.</div>;

  return (
    <div className="session-list">
      <h2>Sessions</h2>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Session ID</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Last Activity</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.id}
              onClick={() => onSelect(session.id)}
              className="session-row"
            >
              <td>
                <span
                  className="status-dot"
                  style={{
                    backgroundColor: STATUS_COLORS[session.status] ?? "#6b7280",
                  }}
                />
                {session.status}
              </td>
              <td className="monospace">{session.id.slice(0, 8)}...</td>
              <td>{formatTime(session.startedAt)}</td>
              <td>{formatDuration(session.startedAt, session.endedAt)}</td>
              <td>
                {session.lastActivityAt
                  ? formatTime(session.lastActivityAt)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
