/**
 * Claude Code Hook Event Types
 *
 * These types represent the JSON payloads that Claude Code passes to hooks via stdin.
 * See: https://code.claude.com/docs/en/hooks
 */

/** Base hook event with common fields */
export interface BaseHookEvent {
  /** Unique session identifier */
  session_id: string;
  /** Path to the full transcript JSON file */
  transcript_path?: string;
}

/** PreToolUse hook - fires BEFORE a tool is executed */
export interface PreToolUseEvent extends BaseHookEvent {
  hook_type: "PreToolUse";
  /** Name of the tool being called (e.g., "Bash", "Read", "mcp__figma__get_file") */
  tool_name: string;
  /** Input parameters for the tool */
  tool_input: Record<string, unknown>;
}

/** PostToolUse hook - fires AFTER a tool completes successfully */
export interface PostToolUseEvent extends BaseHookEvent {
  hook_type: "PostToolUse";
  /** Name of the tool that was called */
  tool_name: string;
  /** Input parameters that were passed to the tool */
  tool_input: Record<string, unknown>;
  /** Response/output from the tool */
  tool_response: unknown;
}

/** Stop hook - fires when the main agent finishes responding */
export interface StopEvent extends BaseHookEvent {
  hook_type: "Stop";
  /** Whether this stop was triggered by a previous stop hook */
  stop_hook_active?: boolean;
}

/** SubagentStop hook - fires when a subagent (Task tool) completes */
export interface SubagentStopEvent extends BaseHookEvent {
  hook_type: "SubagentStop";
  /** Subagent type that completed */
  subagent_type?: string;
}

/** SessionStart hook - fires when a session begins */
export interface SessionStartEvent extends BaseHookEvent {
  hook_type: "SessionStart";
  /** How the session was started (e.g., "new", "resume") */
  start_source?: string;
}

/** SessionEnd hook - fires when a session ends */
export interface SessionEndEvent extends BaseHookEvent {
  hook_type: "SessionEnd";
  /** Reason for session end */
  end_reason?: string;
  /** Session statistics */
  statistics?: {
    duration_ms?: number;
    tool_calls?: number;
    tokens_used?: number;
  };
}

/** Notification hook - fires when Claude sends a notification */
export interface NotificationEvent extends BaseHookEvent {
  hook_type: "Notification";
  /** Notification message */
  message: string;
}

/** PreCompact hook - fires before context compaction */
export interface PreCompactEvent extends BaseHookEvent {
  hook_type: "PreCompact";
}

/** Union of all hook event types */
export type HookEvent =
  | PreToolUseEvent
  | PostToolUseEvent
  | StopEvent
  | SubagentStopEvent
  | SessionStartEvent
  | SessionEndEvent
  | NotificationEvent
  | PreCompactEvent;

/** Hook output for controlling Claude's behavior */
export interface HookOutput {
  /** Decision: approve, block, allow, deny */
  decision?: "approve" | "block" | "allow" | "deny";
  /** Reason shown to Claude */
  reason?: string;
  /** For Stop hooks: force continuation */
  continue?: boolean;
  /** Modified tool input (PreToolUse only) */
  updatedInput?: Record<string, unknown>;
  /** Suppress hook output from transcript */
  suppressOutput?: boolean;
}

/** Configuration for the hook handler */
export interface HookConfig {
  /** Agent Recorder service URL (default: http://127.0.0.1:8787) */
  serviceUrl: string;
  /** Enable debug logging */
  debug: boolean;
}
