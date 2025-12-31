# Agent Recorder — PRD (Claude Code Vertical)

## Vision

Agent Recorder is the **execution flight recorder** for Claude Code: it records what executed (agent/subagent/skill/tool calls) as **evidence**.

## Target platform (v1)

- Claude Code only
- Subagents + skills + MCP tools invoked by Claude Code
  Non-goals: other agents, orchestration, prompt capture, chain-of-thought, cloud sync.

## Core problems

Users can’t easily see:

- which subagent actually did work
- which skills were used vs unused
- which tools ran and in which context
- where time went
- what failed (timeouts/errors)

## MVP requirements

- Local MCP proxy (transparent forward + record)
- Session model + hierarchical event tree
- Event types: agent_call, subagent_call, skill_call, tool_call
- Local SQLite store
- Local REST API + local web UI
- CLI control surface
- Warnings: no-op subagent, unused skills
