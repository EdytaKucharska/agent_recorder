# Telemetry (PostHog)

Telemetry is **opt-in** and **disabled by default**.

Principles:

- anonymous
- content-free (no prompts, no tool payloads)
- non-blocking

Opt-in controls:

- `agent-recorder telemetry enable|disable|status`
- env: `AGENT_RECORDER_TELEMETRY=on|off`

PostHog config:

- POSTHOG_HOST
- POSTHOG_API_KEY

Events (examples):

- app_started, recorder_started, session_created, session_completed, timeline_viewed
- search_used, json_expanded, export_clicked
- recorder_start_failed, mcp_downstream_timeout, no_op_subagent_detected, unused_skills_detected
