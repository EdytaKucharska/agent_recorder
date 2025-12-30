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

export function EventInspectPanel({
  event,
  onClose,
}: EventInspectPanelProps): React.ReactElement {
  const [showJson, setShowJson] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (input === "j") {
      setShowJson((prev) => !prev);
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        title="Event Details"
        hints={[
          { key: "Esc", label: "close" },
          { key: "j", label: "toggle JSON" },
        ]}
      />

      <Box flexDirection="column" marginTop={1}>
        <Row label="ID" value={event.id} />
        <Row label="Type" value={event.eventType} />

        {event.toolName && <Row label="Tool" value={event.toolName} />}
        {event.mcpMethod && <Row label="MCP Method" value={event.mcpMethod} />}
        {event.skillName && <Row label="Skill" value={event.skillName} />}
        {event.agentName && <Row label="Agent" value={event.agentName} />}

        <Row label="Started" value={event.startedAt} />
        <Row label="Ended" value={event.endedAt ?? "still running"} />
        <Row
          label="Duration"
          value={formatDurationMs(event.startedAt, event.endedAt)}
        />

        <Box marginTop={1}>
          <Row
            label="Status"
            value={
              <Text>
                <StatusBadge status={event.status} /> {event.status}
              </Text>
            }
          />
        </Box>

        {event.errorCategory && (
          <Row label="Error" value={event.errorCategory} color="red" />
        )}

        {event.parentEventId && (
          <Row
            label="Parent"
            value={event.parentEventId.slice(0, 12) + "..."}
          />
        )}
      </Box>

      {showJson && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{"─".repeat(66)}</Text>
          <Text bold>Raw Event JSON</Text>
          <Box marginTop={1}>
            <Text dimColor wrap="truncate">
              {JSON.stringify(event, null, 2).slice(0, 1000)}
              {JSON.stringify(event).length > 1000 && "..."}
            </Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>[j] toggle JSON [Esc] close</Text>
      </Box>
    </Box>
  );
}
