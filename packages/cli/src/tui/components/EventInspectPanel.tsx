/**
 * Event inspect panel for viewing event details.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { BaseEvent } from "@agent-recorder/core";
import { Header, StatusBadge } from "./index.js";

export interface EventInspectPanelProps {
  event: BaseEvent;
  onClose: () => void;
}

/**
 * Format duration in ms.
 */
function formatDurationMs(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "running...";
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const ms = end - start;

  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * Render a key-value row.
 */
type TextColor = "red" | "green" | "yellow" | "blue" | "cyan" | "gray";

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: React.ReactNode;
  color?: TextColor;
}): React.ReactElement {
  if (color) {
    return (
      <Box>
        <Box width={14}>
          <Text dimColor>{label}:</Text>
        </Box>
        <Text color={color}>{value}</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Box width={14}>
        <Text dimColor>{label}:</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

/**
 * Format JSON for display, truncating if needed.
 */
function formatJson(json: string | null, maxLength = 500): string {
  if (!json) return "(none)";
  try {
    const parsed = JSON.parse(json);
    const formatted = JSON.stringify(parsed, null, 2);
    if (formatted.length > maxLength) {
      return formatted.slice(0, maxLength) + "\n...";
    }
    return formatted;
  } catch {
    return json.slice(0, maxLength) + (json.length > maxLength ? "..." : "");
  }
}

type ViewMode = "summary" | "input" | "output" | "raw";

export function EventInspectPanel({
  event,
  onClose,
}: EventInspectPanelProps): React.ReactElement {
  const [viewMode, setViewMode] = useState<ViewMode>("summary");

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (input === "i") {
      setViewMode(viewMode === "input" ? "summary" : "input");
    } else if (input === "o") {
      setViewMode(viewMode === "output" ? "summary" : "output");
    } else if (input === "j") {
      setViewMode(viewMode === "raw" ? "summary" : "raw");
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        title="Event Details"
        hints={[
          { key: "Esc", label: "close" },
          { key: "i", label: "input" },
          { key: "o", label: "output" },
          { key: "j", label: "raw" },
        ]}
      />

      <Box flexDirection="column" marginTop={1}>
        <Row label="ID" value={event.id.slice(0, 36)} />
        <Row label="Type" value={event.eventType} />

        {event.toolName && <Row label="Tool" value={event.toolName} />}
        {event.upstreamKey && <Row label="Server" value={event.upstreamKey} />}
        {event.mcpMethod && <Row label="MCP Method" value={event.mcpMethod} />}
        {event.skillName && <Row label="Skill" value={event.skillName} />}
        {event.agentName && <Row label="Agent" value={event.agentName} />}

        <Row
          label="Duration"
          value={formatDurationMs(event.startedAt, event.endedAt)}
        />

        <Row
          label="Status"
          value={
            <Text>
              <StatusBadge status={event.status} /> {event.status}
            </Text>
          }
        />

        {event.errorCategory && (
          <Row label="Error" value={event.errorCategory} color="red" />
        )}
      </Box>

      {viewMode === "input" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(66)}</Text>
          <Text bold color="cyan">
            Input JSON
          </Text>
          <Box marginTop={1}>
            <Text dimColor>{formatJson(event.inputJson)}</Text>
          </Box>
        </Box>
      )}

      {viewMode === "output" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(66)}</Text>
          <Text bold color="green">
            Output JSON
          </Text>
          <Box marginTop={1}>
            <Text dimColor>{formatJson(event.outputJson)}</Text>
          </Box>
        </Box>
      )}

      {viewMode === "raw" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(66)}</Text>
          <Text bold>Raw Event</Text>
          <Box marginTop={1}>
            <Text dimColor>
              {JSON.stringify(event, null, 2).slice(0, 1200)}
              {JSON.stringify(event).length > 1200 && "\n..."}
            </Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>
          <Text dimColor>[i] input</Text>
          {viewMode === "input" && <Text color="cyan"> ●</Text>}
          <Text dimColor>{"  "}[o] output</Text>
          {viewMode === "output" && <Text color="green"> ●</Text>}
          <Text dimColor>{"  "}[j] raw</Text>
          {viewMode === "raw" && <Text color="yellow"> ●</Text>}
          <Text dimColor>{"  "}[Esc] close</Text>
        </Text>
      </Box>
    </Box>
  );
}
