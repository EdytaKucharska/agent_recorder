/**
 * Zod schemas for all MCP tool inputs.
 * Each schema's .shape is passed as the MCP tool inputSchema.
 */

import { z } from "zod";
import type { EventType, EventStatus } from "@agent-recorder/types";

// ── Read tool schemas ──────────────────────────────────────────────────────

export const ListSessionsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  status: z.enum(["active", "completed", "error", "cancelled"]).optional(),
  since: z.string().datetime().optional(),
  upstream_key: z.string().optional(),
});
export type ListSessionsInput = z.infer<typeof ListSessionsInputSchema>;

export const GetSessionInputSchema = z.object({
  session_id: z.string().min(1),
  depth: z.number().int().min(1).max(10).default(10),
  event_types: z
    .array(z.enum(["agent_call", "subagent_call", "skill_call", "tool_call"]))
    .optional(),
  include_io: z.boolean().default(false),
});
export type GetSessionInput = z.infer<typeof GetSessionInputSchema>;

export const QueryTokenUsageInputSchema = z.object({
  group_by: z.enum(["session", "upstream", "tool", "day"]).default("session"),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  session_id: z.string().optional(),
  upstream_key: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});
export type QueryTokenUsageInput = z.infer<typeof QueryTokenUsageInputSchema>;

export const GetTokenBudgetInputSchema = z.object({
  session_id: z.string().min(1),
});
export type GetTokenBudgetInput = z.infer<typeof GetTokenBudgetInputSchema>;

export const ListUpstreamsInputSchema = z.object({
  since: z.string().datetime().optional(),
});
export type ListUpstreamsInput = z.infer<typeof ListUpstreamsInputSchema>;

// ── Write tool schemas ─────────────────────────────────────────────────────

export const RecordEventInputSchema = z.object({
  event_type: z.enum([
    "agent_call",
    "subagent_call",
    "skill_call",
    "tool_call",
  ]),
  session_id: z.string().min(1),
  source: z.string().min(1),
  started_at: z.string().datetime(),
  // Optional fields
  event_id: z.string().uuid().optional(),
  parent_event_id: z.string().uuid().optional(),
  tool_name: z.string().optional(),
  upstream_key: z.string().optional(),
  agent_name: z.string().optional(),
  agent_role: z.string().optional(),
  skill_name: z.string().optional(),
  ended_at: z.string().datetime().optional(),
  status: z
    .enum(["running", "success", "error", "timeout", "cancelled"])
    .default("running"),
  error_category: z
    .enum([
      "downstream_timeout",
      "downstream_unreachable",
      "jsonrpc_invalid",
      "jsonrpc_error",
      "unknown",
    ])
    .optional(),
  error_message: z.string().optional(),
  input_tokens: z.number().int().min(0).optional(),
  output_tokens: z.number().int().min(0).optional(),
  input_preview: z.string().optional(),
  output_preview: z.string().optional(),
  /** Top-level model for cost estimation (not just in metadata) */
  model: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type RecordEventInput = z.infer<typeof RecordEventInputSchema>;

export const CompleteEventInputSchema = z.object({
  event_id: z.string().uuid(),
  session_id: z.string().min(1),
  ended_at: z.string().datetime(),
  status: z.enum(["success", "error", "timeout", "cancelled"]),
  error_category: z
    .enum([
      "downstream_timeout",
      "downstream_unreachable",
      "jsonrpc_invalid",
      "jsonrpc_error",
      "unknown",
    ])
    .optional(),
  error_message: z.string().optional(),
  output_tokens: z.number().int().min(0).optional(),
  output_preview: z.string().optional(),
});
export type CompleteEventInput = z.infer<typeof CompleteEventInputSchema>;

/** Single event entry for ar_record_batch (no session_id/source — inherited from batch) */
export const BatchEventSchema = z.object({
  event_type: z.enum([
    "agent_call",
    "subagent_call",
    "skill_call",
    "tool_call",
  ]),
  started_at: z.string().datetime(),
  event_id: z.string().uuid().optional(),
  parent_event_id: z.string().uuid().optional(),
  tool_name: z.string().optional(),
  upstream_key: z.string().optional(),
  agent_name: z.string().optional(),
  agent_role: z.string().optional(),
  skill_name: z.string().optional(),
  ended_at: z.string().datetime().optional(),
  status: z
    .enum(["running", "success", "error", "timeout", "cancelled"])
    .default("running"),
  error_category: z
    .enum([
      "downstream_timeout",
      "downstream_unreachable",
      "jsonrpc_invalid",
      "jsonrpc_error",
      "unknown",
    ])
    .optional(),
  input_tokens: z.number().int().min(0).optional(),
  output_tokens: z.number().int().min(0).optional(),
  input_preview: z.string().optional(),
  output_preview: z.string().optional(),
  model: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type BatchEvent = z.infer<typeof BatchEventSchema>;

export const RecordBatchInputSchema = z.object({
  session_id: z.string().min(1),
  source: z.string().min(1),
  events: z.array(BatchEventSchema).min(1).max(100),
});
export type RecordBatchInput = z.infer<typeof RecordBatchInputSchema>;

// Re-export EventType and EventStatus for convenience
export type { EventType, EventStatus };
