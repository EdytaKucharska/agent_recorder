---
description: Start the agent recorder daemon to capture MCP tool calls
---

Start the agent recorder daemon. This will begin recording all MCP tool calls, subagent invocations, and skill usage in your Claude Code session.

Run this command to start recording:

```bash
npx agent-recorder start --daemon
```

After starting, all MCP server interactions will be captured and stored locally in SQLite. Use `/agent-recorder:open` to view recorded sessions.
