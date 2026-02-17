---
description: Open the agent recorder TUI to browse recorded sessions
---

Open the interactive terminal UI to browse and inspect recorded sessions.

Run this command to open the TUI:

```bash
npx agent-recorder open
```

In the TUI you can:

- Browse all recorded sessions
- View event timelines (tool calls, subagents, skills)
- Inspect input/output JSON for each event
- Filter and search events
- Export sessions to JSON, HAR, or OpenTelemetry format

Navigation:

- Arrow keys to navigate
- Enter to select
- `i` for input, `o` for output, `j` for raw JSON
- `q` to quit
