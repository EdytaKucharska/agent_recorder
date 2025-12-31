# Claude Code detection rules

Record only observable boundaries; do not infer reasoning.

Event types: agent_call, subagent_call, skill_call, tool_call
Parent linking: tool_call belongs to nearest enclosing agent/subagent/skill.
No-op subagent: subagent_call with zero tool_call children.
