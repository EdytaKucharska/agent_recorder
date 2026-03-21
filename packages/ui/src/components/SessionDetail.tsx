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
  // Use a ref for maxSequence so the polling interval doesn't tear down
  // and re-create on every new event batch. This keeps the effective poll
  // interval at a stable 3s rather than 3s + loadEvents latency.
  const maxSequenceRef = useRef(0);

  const loadEvents = useCallback(
    async (after?: number) => {
      try {
        const [evts, count, session] = await Promise.all([
          getSessionEvents(sessionId, after),
          getEventCount(sessionId),
          getSession(sessionId),
        ]);
        if (after !== undefined) {
          // Incremental: append new events
          setEvents((prev) => [...prev, ...evts]);
        } else {
          // Full load (initial or session change) — reset high-water mark
          // so polling doesn't skip early events of the new session.
          maxSequenceRef.current = 0;
          setEvents(evts);
        }
        setTotalCount(count.count);
        setSessionStatus(session.status);
        if (evts.length > 0) {
          maxSequenceRef.current = evts.at(-1)!.sequence;
        }
        setLoading(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load";
        setError(msg);
        setLoading(false);
      }
    },
    [sessionId]
  );

  // Initial full load
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Auto-refresh: stable interval that reads maxSequence from a ref
  // so it doesn't re-create on every poll cycle.
  // Only starts after initial load completes (loading === false) to
  // prevent a race where the interval fires loadEvents(0) before the
  // initial load finishes, causing duplicate events in state.
  useEffect(() => {
    if (loading || error) return;
    if (sessionStatus && sessionStatus !== "active") return;

    const interval = setInterval(() => {
      loadEvents(maxSequenceRef.current);
    }, 3000);
    return () => clearInterval(interval);
  }, [loading, error, sessionStatus, loadEvents]);

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

/** Max rendering depth to prevent stack overflow from pathological nesting */
const MAX_TREE_DEPTH = 20;

function EventTree({ event, childMap, depth }: EventTreeProps) {
  const children = childMap.get(event.id) ?? [];

  if (depth >= MAX_TREE_DEPTH && children.length > 0) {
    return (
      <div className="event-tree">
        <EventRow event={event} depth={depth} />
        <div
          className="event-tree-truncated"
          style={{ paddingLeft: (depth + 1) * 16 }}
        >
          ▶ {children.length} more nested event
          {children.length !== 1 ? "s" : ""} [max depth reached]
        </div>
      </div>
    );
  }

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
