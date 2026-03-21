import React, { useState } from "react";
import type { BaseEvent } from "@agent-recorder/types";
import { formatDurationMs } from "../utils.js";

interface EventRowProps {
  event: BaseEvent;
  depth: number;
}

const EVENT_TYPE_ICONS: Record<string, string> = {
  agent_call: "A",
  subagent_call: "S",
  skill_call: "K",
  tool_call: "T",
};

const STATUS_COLORS: Record<string, string> = {
  running: "#3b82f6",
  success: "#22c55e",
  error: "#ef4444",
  timeout: "#f59e0b",
  cancelled: "#6b7280",
};

export function EventRow({ event, depth }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);

  const icon = EVENT_TYPE_ICONS[event.eventType] ?? "?";
  const displayName = event.toolName ?? event.agentName;
  const upstream =
    event.upstreamKey && event.upstreamKey !== "builtin"
      ? event.upstreamKey
      : null;

  return (
    <div className="event-row" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
      <div
        className="event-summary"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <span className={`event-type-badge type-${event.eventType}`}>
          {icon}
        </span>
        <span className="event-name">{displayName}</span>
        {upstream && <span className="event-upstream">{upstream}</span>}
        <span
          className="event-status"
          style={{ color: STATUS_COLORS[event.status] ?? "#6b7280" }}
        >
          {event.status}
        </span>
        <span className="event-duration">
          {formatDurationMs(event.startedAt, event.endedAt)}
        </span>
        {event.errorCategory && (
          <span className="event-error-cat">{event.errorCategory}</span>
        )}
        <span className="expand-toggle">{expanded ? "\u25BC" : "\u25B6"}</span>
      </div>

      {expanded && (
        <div className="event-details">
          <div className="detail-grid">
            <div className="detail-label">ID</div>
            <div className="detail-value monospace">{event.id}</div>
            <div className="detail-label">Sequence</div>
            <div className="detail-value">{event.sequence}</div>
            <div className="detail-label">Type</div>
            <div className="detail-value">{event.eventType}</div>
            {event.mcpMethod && (
              <>
                <div className="detail-label">MCP Method</div>
                <div className="detail-value">{event.mcpMethod}</div>
              </>
            )}
            <div className="detail-label">Started</div>
            <div className="detail-value">
              {new Date(event.startedAt).toLocaleString()}
            </div>
            {event.endedAt && (
              <>
                <div className="detail-label">Ended</div>
                <div className="detail-value">
                  {new Date(event.endedAt).toLocaleString()}
                </div>
              </>
            )}
          </div>
          {event.inputJson && (
            <details className="json-block">
              <summary>Input</summary>
              <pre>{formatJson(event.inputJson)}</pre>
            </details>
          )}
          {event.outputJson && (
            <details className="json-block">
              <summary>Output</summary>
              <pre>{formatJson(event.outputJson)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
