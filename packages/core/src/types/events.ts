/**
 * Event types for Agent Recorder.
 * Records observable execution boundaries only — no prompts, no reasoning.
 */

/** Supported event types in the execution hierarchy */
export type EventType =
  | "agent_call"
  | "subagent_call"
  | "skill_call"
  | "tool_call";

/** Status of an event */
export type EventStatus =
  | "running"
  | "success"
  | "error"
  | "timeout"
  | "cancelled";

/** Error category for failed events (stable enum-like values) */
export type ErrorCategory =
  | "downstream_timeout"
  | "downstream_unreachable"
  | "jsonrpc_invalid"
  | "jsonrpc_error"
  | "unknown";

/**
 * Base event shared by all event types.
 * Matches the SQLite schema with denormalized fields for efficient querying.
 */
export interface BaseEvent {
  /** Unique event ID (UUID) */
  id: string;

  /** Session this event belongs to */
  sessionId: string;

  /** Parent event ID (null for root agent_call) */
  parentEventId: string | null;

  /** Per-session ordering sequence number */
  sequence: number;

  /** Type of this event */
  eventType: EventType;

  /** Role of the agent (e.g., "assistant", "user") */
  agentRole: string;

  /** Name of the agent or subagent */
  agentName: string;

  /** Name of the skill (null if not a skill_call or tool within a skill) */
  skillName: string | null;

  /** Name of the tool (for tool_call events) */
  toolName: string | null;

  /** MCP method name (e.g., "tools/call") */
  mcpMethod: string | null;

  /** Upstream server key (for router mode, null for legacy single-upstream) */
  upstreamKey: string | null;

  /** When this event started (ISO 8601) */
  startedAt: string;

  /** When this event ended (ISO 8601, null if still running) */
  endedAt: string | null;

  /** Current status of this event */
  status: EventStatus;

  /** Redacted+truncated input JSON blob */
  inputJson: string | null;

  /** Redacted+truncated output JSON blob */
  outputJson: string | null;

  /** Error category for failed events (null if success/running) */
  errorCategory: ErrorCategory | null;

  /** When this record was created (ISO 8601) */
  createdAt: string;
}

/** Agent call event (root of an execution tree) */
export interface AgentCallEvent extends BaseEvent {
  eventType: "agent_call";
}

/** Subagent call event (child of agent_call or another subagent_call) */
export interface SubagentCallEvent extends BaseEvent {
  eventType: "subagent_call";
}

/** Skill call event (groups related tool calls) */
export interface SkillCallEvent extends BaseEvent {
  eventType: "skill_call";
}

/** Tool call event (leaf node in the hierarchy) */
export interface ToolCallEvent extends BaseEvent {
  eventType: "tool_call";
}

/** Union type for all event types */
export type RecordedEvent =
  | AgentCallEvent
  | SubagentCallEvent
  | SkillCallEvent
  | ToolCallEvent;
