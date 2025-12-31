# Getting Started with Agent Recorder

## Quick Start

1. Install dependencies and build:

   ```bash
   pnpm install && pnpm bootstrap
   ```

2. Install Agent Recorder (creates data directory and config template):

   ```bash
   pnpm ar install
   ```

3. Start the daemon (background mode):

   ```bash
   pnpm ar start --daemon --env-file ~/.agent-recorder/.env
   ```

4. Configure Claude Code (automatic):

   ```bash
   pnpm ar configure claude
   ```

   Or manually add to `~/.claude/settings.json` (Claude Code v2):

   ```json
   {
     "mcpServers": {
       "agent-recorder": {
         "url": "http://127.0.0.1:8788/"
       }
     }
   }
   ```

5. Restart Claude Code to apply changes.

## CLI Commands

### Install

```bash
agent-recorder install
```

Creates `~/.agent-recorder/` directory and `.env` template if they don't exist.
This command is idempotent - it never overwrites existing files.

### Start Daemon

```bash
agent-recorder start                    # Foreground (for development)
agent-recorder start --daemon           # Background daemon
agent-recorder start --daemon --env-file ~/.agent-recorder/.env
agent-recorder start --daemon --force   # Restart if already running
```

Options:

- `--daemon` / `-d`: Run in background (daemon mode)
- `--env-file` / `-e`: Load environment variables from file
- `--force` / `-f`: Kill existing daemon and restart

### Stop Daemon

```bash
agent-recorder stop
agent-recorder stop --force   # Force kill if not responding
```

Stops the running daemon gracefully. Use `--force` to send SIGKILL after 5 seconds.

### Restart Daemon

```bash
agent-recorder restart
agent-recorder restart --env-file ~/.agent-recorder/.env
```

Stops and restarts the daemon in background mode.

### Check Status

```bash
agent-recorder status
```

Shows comprehensive daemon status:

```
Agent Recorder Status
=====================
State:        running
Mode:         daemon
PID:          12345
Uptime:       12m 42s
REST API:     http://127.0.0.1:8787 (✓)
MCP Proxy:    http://127.0.0.1:8788 (✓)
Session:      active (id: abc-123...)
DB Path:      ~/.agent-recorder/agent-recorder.sqlite
```

### View Logs

```bash
agent-recorder logs
agent-recorder logs --tail 100
```

Shows daemon log output (only available in daemon mode).

### Doctor (Health Check)

```bash
agent-recorder doctor
```

Comprehensive health check with sections:

- **Daemon**: State, PID, mode, uptime, REST API, MCP Proxy
- **Configuration**: Claude config path, MCP entry, URL match
- **Downstream MCP**: Configured, reachable status
- **Recording**: Current session, events, last tool_call
- **Suggested Actions**: Actionable fixes for any issues

### Configure Claude Code

```bash
agent-recorder configure claude              # Auto-detect and configure
agent-recorder configure claude --legacy     # Use legacy config path
agent-recorder configure claude --dry-run    # Preview changes
agent-recorder configure show                # Show current config status
```

Safely configures Claude Code to use Agent Recorder:

- Detects v2 (`~/.claude/settings.json`) or legacy (`~/.config/claude/mcp.json`)
- Creates backup before making changes
- Adds/updates `mcpServers.agent-recorder.url`
- Preserves all other config entries

### Diagnose MCP

```bash
agent-recorder diagnose mcp
```

Focused MCP diagnostics:

- Checks proxy is listening
- Checks downstream is configured and reachable
- Tests `tools/list` through proxy
- Reports pass/fail with actionable suggestions

### Mock MCP Server

```bash
agent-recorder mock-mcp                      # Start on default port 9999
agent-recorder mock-mcp --port 8000          # Custom port
agent-recorder mock-mcp --print-env          # Print export command
```

Starts a minimal MCP server for end-to-end testing:

- Implements `tools/list` returning one `echo` tool
- Implements `tools/call` for `echo(text)` → returns text
- Useful for testing proxy without a real downstream

Example workflow:

```bash
# Terminal 1
agent-recorder mock-mcp --port 9999

# Terminal 2
export AR_DOWNSTREAM_MCP_URL="http://127.0.0.1:9999/"
agent-recorder restart
agent-recorder diagnose mcp
```

### List Sessions

```bash
agent-recorder sessions list
agent-recorder sessions list --status active
```

Lists all recorded sessions with event counts.

### Show Session Details

```bash
agent-recorder sessions show <session-id>
```

Shows details for a specific session.

### Get Current Session

```bash
agent-recorder sessions current
```

Prints the current active session ID (useful for scripting).

### Tail Session Events

```bash
agent-recorder sessions tail <session-id>
agent-recorder sessions tail <session-id> --interval 500 --n 100
```

Streams session events in real-time (like `tail -f`). Options:

- `--interval <ms>`: Poll interval in milliseconds (default: 1000)
- `--n <count>`: Number of recent events to show initially (default: 50)

Press Ctrl+C to stop.

### View Session (with analytics)

```bash
agent-recorder sessions view <session-id>
agent-recorder sessions view <session-id> --tail 50
agent-recorder sessions view <session-id> --follow
```

View session events with a header summary showing counts and top tools. Options:

- `--tail <n>`: Show last N events (default: 200)
- `--follow`: Follow new events in real-time (like `tail -f`)
- `--interval <ms>`: Poll interval for follow mode (default: 1000)

### Session Statistics

```bash
agent-recorder sessions stats <session-id>
```

Shows detailed session statistics:

- Tool call counts (sorted by frequency)
- Slowest calls (top 10)
- Error categories
- Summary stats (total, success, errors, timeouts, durations)

### Search/Filter Events (grep)

```bash
agent-recorder sessions grep <session-id>
agent-recorder sessions grep <session-id> --status error
agent-recorder sessions grep <session-id> --tool Bash --status error
agent-recorder sessions grep <session-id> --error downstream_timeout
agent-recorder sessions grep <session-id> --json
```

Filter session events by criteria. Options:

- `--tool <name>`: Filter by tool name
- `--status <status>`: Filter by status (success|error|timeout|running|cancelled)
- `--error <category>`: Filter by error category
- `--since-seq <n>`: Only events after sequence N
- `--json`: Output as JSON array (for piping)

### Summarize Session

```bash
agent-recorder sessions summarize <session-id>
agent-recorder sessions summarize <session-id> --format json
```

Generate a safe, metadata-only summary. Options:

- `--format <format>`: Output format, `text` or `json` (default: text)

Summary includes:

- Total tool calls with breakdown by tool
- Error count and categories
- Slowest call
- Total wall time

### Export Session

```bash
agent-recorder export <session-id>
agent-recorder export <session-id> --format json --out session.json
```

Exports session events to JSON or JSONL format. Options:

- `--format <format>`: Output format, `json` or `jsonl` (default: jsonl)
- `--out <path>`: Output file path (stdout if not specified)

JSONL format includes a `type` field on each line (`session` or `event`).

## Error Categories

Events can have the following error categories when `status` is `error` or `timeout`:

| Category                 | Meaning                                     |
| ------------------------ | ------------------------------------------- |
| `downstream_timeout`     | Request to downstream MCP server timed out  |
| `downstream_unreachable` | Could not connect to downstream MCP server  |
| `jsonrpc_invalid`        | JSON-RPC request/response validation failed |
| `jsonrpc_error`          | Downstream returned JSON-RPC error response |
| `unknown`                | Unclassified error                          |

Error categories are derived from metadata only - no content is exposed.

## Environment Variables

| Variable                | Default                                   | Description                                |
| ----------------------- | ----------------------------------------- | ------------------------------------------ |
| `AR_LISTEN_PORT`        | 8787                                      | REST API port                              |
| `AR_MCP_PROXY_PORT`     | 8788                                      | MCP proxy port                             |
| `AR_DB_PATH`            | `~/.agent-recorder/agent-recorder.sqlite` | SQLite database path                       |
| `AR_DOWNSTREAM_MCP_URL` | (none)                                    | Upstream MCP server URL (optional)         |
| `AR_REDACT_KEYS`        | (see .env.example)                        | Comma-separated keys to redact             |
| `AR_DEBUG_PROXY`        | (off)                                     | Set to `1` for debug logging of tool calls |

## Debug Logging

Enable debug logging to see tool call metadata in the daemon output:

```bash
AR_DEBUG_PROXY=1 agent-recorder start
```

Or add to your `.env` file:

```
AR_DEBUG_PROXY=1
```

Debug output shows metadata only (no payloads): session ID, sequence number, tool name, status, and duration.

## Graceful Shutdown

The daemon handles signals gracefully:

| Signal          | Session Status | Use Case                            |
| --------------- | -------------- | ----------------------------------- |
| SIGINT (Ctrl+C) | completed      | User intentionally stopped          |
| SIGTERM         | cancelled      | External termination (stop command) |
| SIGHUP          | (ignored)      | No reload needed                    |

On shutdown:

- Active session is marked with the appropriate status
- All connections are closed cleanly
- PID file and lock file are removed (daemon mode)
- Database is properly closed

## Running as a Background Service

### Quick Start

```bash
# Install and start
pnpm ar install
pnpm ar start --daemon --env-file ~/.agent-recorder/.env

# Check status
pnpm ar status

# View logs
pnpm ar logs

# Stop when needed
pnpm ar stop
```

### Files

All daemon state files are stored in `~/.agent-recorder/`:

| File                    | Purpose                      |
| ----------------------- | ---------------------------- |
| `agent-recorder.pid`    | Process ID of running daemon |
| `agent-recorder.lock`   | Single-instance lock file    |
| `agent-recorder.log`    | Daemon stdout/stderr output  |
| `agent-recorder.sqlite` | Event database               |
| `.env`                  | Environment configuration    |

### Single Instance

Only one daemon instance can run at a time. The lockfile prevents duplicate starts:

```bash
# This will fail if daemon is already running:
pnpm ar start --daemon
# Output: Daemon is already running (PID 12345).

# Use --force to restart:
pnpm ar start --daemon --force
```

### Resetting State

If you need to reset the daemon state:

```bash
# Stop daemon
pnpm ar stop

# Remove state files (optional)
rm ~/.agent-recorder/agent-recorder.pid
rm ~/.agent-recorder/agent-recorder.lock

# Restart
pnpm ar start --daemon
```

The database (`agent-recorder.sqlite`) is preserved across restarts.

## Releasing (Maintainers)

Agent Recorder uses tag-based publishing to npm with OIDC trusted publishing (no tokens required).

### One-Time Setup (Trusted Publishing)

Configure npm to trust GitHub Actions:

1. Go to https://www.npmjs.com/package/agent-recorder/access
2. Find the **Trusted Publisher** section
3. Click **Add trusted publisher** and select **GitHub Actions**
4. Fill in:
   - **Organization/user**: `EdytaKucharska`
   - **Repository**: `agent_recorder`
   - **Workflow filename**: `publish.yml`
   - **Environment**: (leave empty)
5. Save

This allows the publish workflow to authenticate automatically via OIDC - no secrets needed.

### Release Process

1. **Ensure CI passes** on main branch

2. **Create and push a version tag**:

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

3. **Monitor the publish workflow** in GitHub Actions

The publish workflow will:

- Build the distribution package
- Set the package version to match the tag (e.g., `v0.3.0` → `0.3.0`)
- Publish `packages/dist` to npm as `agent-recorder` with provenance

### Version Source of Truth

The git tag is the source of truth for the published version. The `packages/dist/package.json` version is overwritten during publish to match the tag.

### Troubleshooting

**Version already exists on npm**: The publish will fail if you try to republish an existing version. Create a new tag with a higher version number.

**CI failures**: The publish workflow does not run CI checks. Ensure CI passes on main before tagging.

**OIDC authentication failed**: Ensure the trusted publisher is configured correctly on npmjs.com. The workflow filename must match exactly (`publish.yml`).
