# Agent Recorder

Local-first flight recorder for Claude Code. Captures a persistent, human-readable timeline of execution including subagents, skills, and MCP tool calls.

## Install

```bash
npm install -g agent-recorder
```

## Quick Start

```bash
# Set up ~/.agent-recorder/ directory
agent-recorder install

# Start the background daemon
agent-recorder start --daemon

# Configure Claude Code integration
agent-recorder configure claude

# Verify everything is working
agent-recorder doctor
```

After configuration, restart Claude Code to apply changes.

## Requirements

- Node.js >= 20
- macOS or Linux

## Commands

### Daemon Lifecycle

- `agent-recorder start [--daemon]` - Start the recording daemon
- `agent-recorder stop` - Stop the daemon
- `agent-recorder restart` - Restart the daemon
- `agent-recorder status` - Check if daemon is running

### Health & Diagnostics

- `agent-recorder doctor` - Comprehensive health check
- `agent-recorder diagnose mcp` - MCP proxy diagnostics
- `agent-recorder logs` - View daemon logs

### Configuration

- `agent-recorder install` - Set up directories and show config
- `agent-recorder configure claude` - Configure Claude Code MCP settings
- `agent-recorder configure show` - Show current configuration

### Session Browsing

- `agent-recorder sessions list` - List all recorded sessions
- `agent-recorder sessions show <id>` - Show session details
- `agent-recorder sessions view <id>` - View session events
- `agent-recorder sessions tail <id>` - Follow session events in real-time
- `agent-recorder tui` - Interactive session explorer

### Data Export

- `agent-recorder export <id>` - Export session to JSON/JSONL

### Testing

- `agent-recorder mock-mcp` - Start a mock MCP server for testing

## Environment Variables

- `AR_LISTEN_PORT` - REST API port (default: 8787)
- `AR_MCP_PROXY_PORT` - MCP proxy port (default: 8788)
- `AR_DB_PATH` - SQLite database path
- `AR_DOWNSTREAM_MCP_URL` - URL of the downstream MCP server to proxy

## How It Works

Agent Recorder acts as a transparent MCP proxy between Claude Code and your MCP servers. It records:

- Tool calls (tools/list, tools/call)
- Timing and duration
- Success/error status
- Metadata (redacted for privacy)

It does **not** record prompts, chain-of-thought, or sensitive content.

## Troubleshooting

### Daemon won't start

```bash
# Check if port is already in use
lsof -i :8787
lsof -i :8788

# Force stop and restart
agent-recorder stop --force
agent-recorder start --daemon
```

### Claude Code not connecting

```bash
# Check configuration
agent-recorder configure show

# Re-configure if needed
agent-recorder configure claude

# Restart Claude Code after configuration changes
```

### No events being recorded

```bash
# Run full diagnostics
agent-recorder doctor

# Check MCP proxy specifically
agent-recorder diagnose mcp

# Test with mock MCP server
agent-recorder mock-mcp --port 9999
# In another terminal:
export AR_DOWNSTREAM_MCP_URL="http://127.0.0.1:9999/"
agent-recorder restart
```

## License

MIT
