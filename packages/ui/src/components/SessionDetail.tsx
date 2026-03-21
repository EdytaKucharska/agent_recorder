import React, { useEffect, useState, useCallback, useRef } from "react";
import type { BaseEvent } from "@agent-recorder/types";
import { getSession, getSessionEvents, getEventCount } from "../api.js";
import { EventRow } from "./EventRow.js";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const [events, setEvents] = useState<BaseEvent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>("");
  const sessionStatusRef = useRef(sessionStatus);

  // Keep ref in sync with state
  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  const loadEvents = useCallback(async () => {
    try {
      const [evts, count, session] = await Promise.all([
        getSessionEvents(sessionId),
        getEventCount(sessionId),
        getSession(sessionId),
      ]);
      setEvents(evts);
      setTotalCount(count.count);
      setSessionStatus(session.status);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadEvents();
    // Auto-refresh every 3 seconds only for active sessions.
    // Uses a ref to read current status without re-creating the interval.
    const interval = setInterval(() => {
      const status = sessionStatusRef.current;
      if (status && status !== "active") return;
      loadEvents();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  if (loading) return <div className="loading">Loading events...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  // Build parent-child lookup for tree rendering
  const childMap = new Map<string | null, BaseEvent[]>();
  for (const event of events) {
    const parentId = event.parentEventId;
    const children = childMap.get(parentId) ?? [];
    children.push(event);
    childMap.set(parentId, children);
  }

  // Root events have no parent
  const rootEvents = childMap.get(null) ?? [];

  return (
    <div className="session-detail">
      <div className="session-header">
        <h2>
          Session <span className="monospace">{sessionId.slice(0, 8)}...</span>
        </h2>
        <div className="session-meta">
          <span className={`status-badge status-${sessionStatus}`}>
            {sessionStatus}
          </span>
          <span className="event-count">{totalCount} events</span>
        </div>
      </div>

      <div className="events-timeline">
        {rootEvents.length === 0 ? (
          <div className="empty">No events recorded yet.</div>
        ) : (
          rootEvents.map((event) => (
            <EventTree
              key={event.id}
              event={event}
              childMap={childMap}
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface EventTreeProps {
  event: BaseEvent;
  childMap: Map<string | null, BaseEvent[]>;
  depth: number;
}

function EventTree({ event, childMap, depth }: EventTreeProps) {
  const children = childMap.get(event.id) ?? [];

  return (
    <div className="event-tree">
      <EventRow event={event} depth={depth} />
      {children.map((child) => (
        <EventTree
          key={child.id}
          event={child}
          childMap={childMap}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
