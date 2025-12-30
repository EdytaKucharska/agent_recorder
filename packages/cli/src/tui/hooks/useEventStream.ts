/**
 * Hook for polling events from the API.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { BaseEvent } from "@agent-recorder/core";
import { fetchEvents } from "../api.js";

export interface UseEventStreamOptions {
  /** Whether to poll for new events */
  enabled: boolean;
  /** Polling interval in ms (default: 1000) */
  interval?: number;
}

export interface UseEventStreamResult {
  events: BaseEvent[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Poll for events from a session.
 * Tracks last sequence to fetch only new events.
 */
export function useEventStream(
  baseUrl: string,
  sessionId: string,
  options: UseEventStreamOptions
): UseEventStreamResult {
  const { enabled, interval = 1000 } = options;

  const [events, setEvents] = useState<BaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const lastSequenceRef = useRef(0);
  const mountedRef = useRef(true);

  const loadEvents = useCallback(
    async (incremental: boolean) => {
      try {
        const newEvents = await fetchEvents(baseUrl, sessionId, {
          after: incremental ? lastSequenceRef.current : 0,
          limit: 200,
        });

        if (!mountedRef.current) return;

        if (newEvents.length > 0) {
          const maxSeq = Math.max(...newEvents.map((e) => e.sequence));
          lastSequenceRef.current = maxSeq;

          if (incremental) {
            setEvents((prev) => [...prev, ...newEvents]);
          } else {
            setEvents(newEvents);
          }
        }

        setError(null);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [baseUrl, sessionId]
  );

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    lastSequenceRef.current = 0;
    setEvents([]);
    setLoading(true);
    loadEvents(false);

    return () => {
      mountedRef.current = false;
    };
  }, [baseUrl, sessionId, loadEvents]);

  // Polling
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      loadEvents(true);
    }, interval);

    return () => clearInterval(timer);
  }, [enabled, interval, loadEvents]);

  const refresh = useCallback(async () => {
    lastSequenceRef.current = 0;
    setLoading(true);
    await loadEvents(false);
  }, [loadEvents]);

  return { events, loading, error, refresh };
}
