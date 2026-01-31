/**
 * Sessions list screen with table and navigation.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import type { SessionWithActivity } from "@agent-recorder/core";
import {
  Header,
  Table,
  StatusBadge,
  Spinner,
  type Column,
} from "../components/index.js";
import { fetchSessions, fetchEventCount } from "../api.js";

export interface SessionsScreenProps {
  baseUrl: string;
  onSelectSession: (sessionId: string) => void;
}

interface SessionWithCount extends SessionWithActivity {
  eventCount: number;
}

/**
 * Format time ago.
 */
function formatTimeAgo(isoDate: string): string {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Format duration.
 */
function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function SessionsScreen({
  baseUrl,
  onSelectSession,
}: SessionsScreenProps): React.ReactElement {
  const { exit } = useApp();

  const [sessions, setSessions] = useState<SessionWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const sessionsData = await fetchSessions(baseUrl);

      // Fetch event counts for each session
      const sessionsWithCounts = await Promise.all(
        sessionsData.map(async (session) => {
          const eventCount = await fetchEventCount(baseUrl, session.id);
          return { ...session, eventCount };
        })
      );

      setSessions(sessionsWithCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  // Initial load
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-refresh every 2 seconds
  useEffect(() => {
    const timer = setInterval(loadSessions, 2000);
    return () => clearInterval(timer);
  }, [loadSessions]);

  // Filter sessions by search query
  const filteredSessions = searchQuery
    ? sessions.filter((s) =>
        s.id.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  // Handle keyboard input
  useInput((input, key) => {
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery("");
      }
      return;
    }

    if (input === "q") {
      exit();
      return;
    }

    if (input === "/" || input === "s") {
      setSearchMode(true);
      return;
    }

    if (input === "r") {
      loadSessions();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) =>
        Math.min(filteredSessions.length - 1, prev + 1)
      );
    } else if (key.return) {
      const selectedSession = filteredSessions[selectedIndex];
      if (filteredSessions.length > 0 && selectedSession) {
        onSelectSession(selectedSession.id);
      }
    }
  });

  // Reset selection when filtered list changes
  useEffect(() => {
    if (selectedIndex >= filteredSessions.length) {
      setSelectedIndex(Math.max(0, filteredSessions.length - 1));
    }
  }, [filteredSessions.length, selectedIndex]);

  const columns: Column<SessionWithCount>[] = [
    {
      key: "id",
      header: "ID",
      width: 14,
      render: (row) => <Text>{row.id.slice(0, 12)}...</Text>,
    },
    {
      key: "status",
      header: "Status",
      width: 10,
      render: (row) => (
        <Text>
          <StatusBadge status={row.status} /> {row.status}
        </Text>
      ),
    },
    {
      key: "events",
      header: "Events",
      width: 8,
      render: (row) => <Text>{row.eventCount}</Text>,
    },
    {
      key: "lastActivity",
      header: "Last Active",
      width: 12,
      render: (row) => (
        <Text dimColor>
          {formatTimeAgo(row.lastActivityAt ?? row.startedAt)}
        </Text>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      width: 10,
      render: (row) => (
        <Text dimColor>{formatDuration(row.startedAt, row.endedAt)}</Text>
      ),
    },
  ];

  if (error) {
    return (
      <Box flexDirection="column">
        <Header
          title="Sessions"
          hints={[
            { key: "q", label: "quit" },
            { key: "r", label: "retry" },
          ]}
        />
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press r to retry or q to quit.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header
        title="Sessions"
        hints={[
          { key: "q", label: "quit" },
          { key: "/", label: "search" },
        ]}
      />

      {searchMode && (
        <Box marginTop={1}>
          <Text>Search: </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="session id..."
          />
          <Text dimColor> (Esc to cancel)</Text>
        </Box>
      )}

      <Box marginTop={1}>
        {loading && sessions.length === 0 ? (
          <Spinner label="Loading sessions..." />
        ) : filteredSessions.length === 0 ? (
          <Text dimColor>
            {searchQuery ? "No matching sessions" : "No sessions recorded"}
          </Text>
        ) : (
          <Table
            columns={columns}
            data={filteredSessions}
            selectedIndex={selectedIndex}
            maxRows={15}
          />
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [↑/↓] navigate [Enter] view [r] refresh
          {loading && sessions.length > 0 && " (refreshing...)"}
        </Text>
      </Box>
    </Box>
  );
}
