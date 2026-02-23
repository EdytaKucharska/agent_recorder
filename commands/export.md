---
description: Export a recorded session to JSON, HAR, or OpenTelemetry format
---

Export a recorded session for analysis or integration with other tools.

Available formats:

- `json` - Native format with full event details
- `har` - HTTP Archive format for browser dev tools
- `otlp` - OpenTelemetry traces for observability platforms

Usage:

```bash
# Export to JSON (default)
npx agent-recorder export <session-id>

# Export to HAR format
npx agent-recorder export <session-id> --format har

# Export to OpenTelemetry
npx agent-recorder export <session-id> --format otlp
```

Use `/agent-recorder:open` to find session IDs, or:

```bash
npx agent-recorder session list
```
