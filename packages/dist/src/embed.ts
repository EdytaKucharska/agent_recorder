/**
 * Agent Recorder — Embeddable API
 *
 * Use this import to embed Agent Recorder's recording capabilities
 * into your own agent, orchestrator, or tool.
 *
 * @example
 * ```typescript
 * import { createMcpProxy, createServer, startServer } from "agent-recorder/embed";
 * ```
 *
 * This module re-exports the composable building blocks:
 * - MCP proxy (transparent forward + record)
 * - REST API server (session and event inspection)
 * - Session management
 * - Type definitions (events, sessions, storage adapter)
 */

// Types — zero dependencies, safe to use everywhere
// Note: StorageAdapter is @alpha and may change between minor versions.
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
  SessionStatus,
  Session,
  StorageAdapter,
  InsertEventInput,
  EventQueryOptions,
  EventFilterOptions,
} from "@agent-recorder/types";

// Service — composable building blocks
export {
  createServer,
  startServer,
  createMcpProxy,
  createSessionManager,
  createDaemonContext,
  type DaemonContext,
  type DaemonHandle,
} from "@agent-recorder/service";

// Core — database and utilities
export {
  openDatabase,
  openMemoryDatabase,
  runMigrations,
  getDefaultMigrationsDir,
  loadConfig,
  type Config,
} from "@agent-recorder/core";
