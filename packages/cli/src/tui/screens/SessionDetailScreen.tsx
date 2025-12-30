/**
 * Session detail screen with event list and live follow.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { BaseEvent, EventType } from "@agent-recorder/core";
import {
  Header,
  Table,
  StatusBadge,
  Spinner,
  type Column,
} from "../components/index.js";
import { fetchSession, fetchEventCount } from "../api.js";
import { useEventStream } from "../hooks/useEventStream.js";
import type { Session } from "@agent-recorder/core";

export interface SessionDetailScreenProps {
  baseUrl: string;
  sessionId: string;
  onBack: () => void;
  onInspectEvent: (event: BaseEvent) => void;
}

type FilterType = "all" | EventType;
const FILTER_OPTIONS: FilterType[] = [
  "all",
  "agent_call",
  "subagent_call",
  "skill_call",
  "tool_call",
];

/**
 * Format time from ISO string.
 */
function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Format duration in ms.
 */
function formatDurationMs(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "--";
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const ms = end - start;

  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m`;
}

/**
 * Get display name for an event.
 */
function getEventName(event: BaseEvent): string {
  if (event.toolName) return event.toolName;
  if (event.skillName) return event.skillName;
  if (event.agentName) return event.agentName;
  return event.eventType;
}

/**
 * Get status symbol.
 */
function getStatusSymbol(status: string): string {
  switch (status) {
    case "success":
      return "\u2713";
    case "error":
      return "\u2717";
    case "running":
      return "\u2192";
    case "timeout":
      return "\u23f1";
    default:
      return "?";
  }
}

export function SessionDetailScreen({
  baseUrl,
  sessionId,
  onBack,
  onInspectEvent,
}: SessionDetailScreenProps): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<FilterType>("all");
  const [followMode, setFollowMode] = useState(true);

  const { events, loading, error, refresh } = useEventStream(
    baseUrl,
    sessionId,
    {
      enabled: followMode,
      interval: 1000,
    }
  );

  // Load session info
  const loadSessionInfo = useCallback(async () => {
    const [sessionData, count] = await Promise.all([
      fetchSession(baseUrl, sessionId),
      fetchEventCount(baseUrl, sessionId),
    ]);
    setSession(sessionData);
    setEventCount(count);
  }, [baseUrl, sessionId]);

  useEffect(() => {
    loadSessionInfo();
    const timer = setInterval(loadSessionInfo, 2000);
    return () => clearInterval(timer);
  }, [loadSessionInfo]);

  // Filter events
  const filteredEvents =
    filter === "all" ? events : events.filter((e) => e.eventType === filter);

  // Auto-scroll to bottom in follow mode
  useEffect(() => {
    if (followMode && filteredEvents.length > 0) {
      setSelectedIndex(filteredEvents.length - 1);
    }
  }, [followMode, filteredEvents.length]);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (input === "f") {
      setFollowMode((prev) => !prev);
      return;
    }

    if (key.tab) {
      const currentIdx = FILTER_OPTIONS.indexOf(filter);
      const nextIdx = (currentIdx + 1) % FILTER_OPTIONS.length;
      const nextFilter = FILTER_OPTIONS[nextIdx];
      if (nextFilter !== undefined) {
        setFilter(nextFilter);
      }
      setSelectedIndex(0);
      return;
    }

    if (input === "r") {
      refresh();
      return;
    }

    if (key.upArrow) {
      setFollowMode(false);
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setFollowMode(false);
      setSelectedIndex((prev) => Math.min(filteredEvents.length - 1, prev + 1));
    } else if (key.return) {
      const selectedEvent = filteredEvents[selectedIndex];
      if (filteredEvents.length > 0 && selectedEvent) {
        onInspectEvent(selectedEvent);
      }
    }
  });

  // Reset selection when filter changes
  useEffect(() => {
    if (selectedIndex >= filteredEvents.length) {
      setSelectedIndex(Math.max(0, filteredEvents.length - 1));
    }
  }, [filteredEvents.length, selectedIndex]);

  const columns: Column<BaseEvent>[] = [
    {
      key: "time",
      header: "Time",
      width: 10,
      render: (row) => <Text dimColor>{formatTime(row.startedAt)}</Text>,
    },
    {
      key: "type",
      header: "Type",
      width: 14,
      render: (row) => <Text>{row.eventType}</Text>,
    },
    {
      key: "name",
      header: "Name",
      width: 20,
      render: (row) => <Text>{getEventName(row).slice(0, 18)}</Text>,
    },
    {
      key: "duration",
      header: "Duration",
      width: 10,
      render: (row) => (
        <Text dimColor>{formatDurationMs(row.startedAt, row.endedAt)}</Text>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 8,
      render: (row) => (
        <Text>
          <StatusBadge status={row.status} /> {getStatusSymbol(row.status)}
        </Text>
      ),
    },
  ];

  if (error) {
    return (
      <Box flexDirection="column">
        <Header
          title={`Session ${sessionId.slice(0, 12)}...`}
          hints={[
            { key: "Esc", label: "back" },
            { key: "r", label: "retry" },
          ]}
        />
        <Box marginTop={1}>
          <Text color="red">Error: {error.message}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Box>
          <Text bold>Session {sessionId.slice(0, 12)}...</Text>
          {session && (
            <Text>
              {"  "}
              <StatusBadge status={session.status} /> {session.status}
            </Text>
          )}
          <Text dimColor>
            {"  "}Events: {eventCount}
          </Text>
        </Box>
        <Box>
          <Text color="cyan">[Esc]</Text> <Text dimColor>back</Text>
          {"  "}
          <Text color="cyan">[f]</Text> <Text dimColor>follow</Text>
        </Box>
      </Box>

      {/* Filter tabs */}
      <Box marginTop={1}>
        <Text dimColor>Filter: </Text>
        {FILTER_OPTIONS.map((opt) => (
          <Text key={opt}>
            {opt === filter ? (
              <Text color="cyan" bold>
                [{opt}]
              </Text>
            ) : (
              <Text dimColor>{opt}</Text>
            )}
            {"  "}
          </Text>
        ))}
      </Box>

      <Text dimColor>{"─".repeat(66)}</Text>

      <Box marginTop={1}>
        {loading && events.length === 0 ? (
          <Spinner label="Loading events..." />
        ) : filteredEvents.length === 0 ? (
          <Text dimColor>
            {filter === "all" ? "No events recorded" : `No ${filter} events`}
          </Text>
        ) : (
          <Table
            columns={columns}
            data={filteredEvents}
            selectedIndex={selectedIndex}
            maxRows={12}
          />
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [↑/↓] navigate [Enter] inspect [Tab] filter [f] follow:{" "}
          {followMode ? (
            <Text color="green">ON</Text>
          ) : (
            <Text color="gray">OFF</Text>
          )}
        </Text>
      </Box>
    </Box>
  );
}
