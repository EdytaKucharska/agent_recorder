/**
 * @agent-recorder/types
 *
 * Portable type definitions for Agent Recorder.
 * ZERO dependencies — safe to import in any context:
 * agents, SDKs, cloud services, web frontends, tests.
 */

export type {
  EventType,
  EventStatus,
  ErrorCategory,
  BaseEvent,
  AgentCallEvent,
  SubagentCallEvent,
  SkillCallEvent,
  ToolCallEvent,
  RecordedEvent,
} from "./events.js";

export type { SessionStatus, Session } from "./session.js";

export type {
  InsertEventInput,
  EventQueryOptions,
  EventFilterOptions,
  StorageAdapter,
} from "./storage.js";
