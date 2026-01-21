# Why Proxying MCP Traffic Is Harder Than You Think

*Lessons from building an observability tool for Claude Code—and why we pivoted from proxy-based to hooks-based monitoring in just a few days.*

---

## TL;DR

We tried to build an HTTP proxy for MCP observability. It doesn't work for most real-world MCP servers because: (1) most use stdio transport (local subprocesses, no network traffic), (2) remote servers use OAuth tokens that Claude manages internally, and (3) stdio interception alternatives are too fragile. The solution: use Claude Code's native hooks system instead.

---

## The Problem

As AI coding agents become mainstream, observability matters. We wanted to answer:

- What tools did Claude Code use during this session?
- How long did each MCP call take?
- What data flowed to external services?

Our approach: an HTTP proxy between Claude Code and MCP servers. Record everything.

```
┌──────────────┐      ┌─────────────┐      ┌────────────┐
│  Claude Code │ ───► │   Proxy     │ ───► │ MCP Server │
└──────────────┘      │  (recorder) │      └────────────┘
                      └─────────────┘
```

After a few days of development and testing, we discovered this approach works for almost nothing in the real MCP ecosystem.

---

## Constraint 1: stdio Transport Dominance

### What We Expected

MCP servers would use HTTP—that's how modern APIs work.

### What We Found

Most MCP servers use **stdio transport**: local subprocesses communicating via stdin/stdout.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

Claude Code spawns this as a child process. Communication happens through process streams—no network traffic to intercept.

```
┌──────────────┐      stdin/stdout      ┌────────────────┐
│  Claude Code │ ◄──────────────────►   │ MCP subprocess │
└──────────────┘     (no network!)      └────────────────┘
```

### Why stdio Dominates

| Reason | Explanation |
|--------|-------------|
| Zero network overhead | Direct process communication |
| Implicit security | User launched both client and server |
| Secrets stay local | Env vars never leave the machine |
| npx/uvx convenience | No installation, just run |

The MCP ecosystem evolved around local-first tooling. By the time we built our proxy, most servers were stdio-only.

---

## Constraint 2: Why We Ruled Out stdio Interception

"Just intercept stdin/stdout" sounds easy. Before committing to the proxy approach, we evaluated several alternatives—and ruled them out during design.

### Wrapper Scripts (Evaluated)

The idea: wrap the MCP command to tee stdin/stdout to a recorder:

```bash
#!/bin/bash
exec npx ... | tee /tmp/mcp.log
```

**Why we ruled it out:**
- Bidirectional streams are tricky—stdin and stdout are separate pipes
- Buffering issues would corrupt JSON-RPC message boundaries
- Every MCP server would need a custom wrapper
- Users would have to modify their config for every server

### LD_PRELOAD Interception (Considered, Not Built)

In theory, you could inject a shared library to intercept read()/write() calls:

```bash
LD_PRELOAD=/path/to/intercept.so npx ...
```

**Why we didn't pursue it:**
- Linux-only (no macOS support without different techniques)
- Breaks with statically linked binaries
- Security tools may flag it as suspicious
- Fragile across Node.js versions and runtime changes

### ptrace/strace Monitoring (Considered, Not Built)

Another theoretical option: attach a debugger to trace syscalls:

```bash
strace -f -e read,write npx ...
```

**Why we didn't pursue it:**
- Significant performance overhead
- Platform-specific (ptrace on Linux, dtrace on macOS)
- Requires elevated permissions on some systems
- Output parsing is complex and error-prone

### Our Conclusion

We ruled out these approaches during design—not after building them. The common problem: **fragility**. For a developer tool, reliability matters more than coverage. We'd rather support fewer scenarios reliably than more scenarios poorly.

---

## Constraint 3: The OAuth Wall

For HTTP-based MCP servers (Figma, Notion, Amplitude), we assumed we could proxy requests by forwarding credentials.

### What Actually Happens

```
1. Claude Code → Figma OAuth → Browser consent
2. User clicks "Authorize"
3. Figma redirects to localhost callback
4. Claude Code exchanges code for tokens
5. Claude Code stores tokens internally
6. Tokens are NEVER exposed in config or headers
```

We tested with personal access tokens as a workaround:

```bash
curl -X POST https://mcp.figma.com/mcp \
  -H "Authorization: Bearer figd_xxx..." \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'

# Response: Unauthorized
```

Figma's MCP endpoint only accepts OAuth tokens—PATs don't work. This is intentional security design.

| Provider | Auth Method | Proxy Works? |
|----------|-------------|--------------|
| Figma | OAuth 2.0 | No |
| Notion | OAuth 2.0 | No |
| Amplitude | OAuth 2.0 | No |

Even if we intercepted the OAuth flow, tokens expire and refresh. Claude Code handles this automatically. Replicating that auth system would be complex and security-sensitive.

---

## Constraint 4: Configuration Complexity

Claude Code uses multiple config files with precedence rules:

| Location | Scope | Priority |
|----------|-------|----------|
| `~/.claude/settings.json` | Global (v2) | Lower |
| `~/.config/claude/mcp.json` | Global (legacy) | Lower |
| `.claude/settings.json` | Project-level | Higher |

When a user configures an MCP server in the project-level file, it overrides global settings. Our proxy setup in the global config was silently ignored for projects with local configs.

Debugging required understanding config resolution, transport selection, and OAuth state simultaneously.

---

## What Actually Works

After all testing, our proxy approach reliably monitors:

**Works:**
- Self-hosted MCP servers (you control auth)
- Servers with static API keys (rare)
- Internal/enterprise servers

**Doesn't work:**
- stdio MCP servers (majority of ecosystem)
- OAuth-protected servers (Figma, Notion, etc.)
- Any server where Claude manages auth

---

## The Better Approach: Hooks

Claude Code provides native hooks that fire at lifecycle events:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "/path/to/record-tool.sh"
      }]
    }]
  }
}
```

```
┌──────────────┐                    ┌────────────┐
│  Claude Code │ ────────────────►  │ MCP Server │
└──────────────┘                    └────────────┘
       │
       │ hook fires
       ▼
┌──────────────┐
│   Recorder   │
└──────────────┘
```

### What Hooks Capture

| Hook | Trigger | Data |
|------|---------|------|
| PreToolUse | Before any tool | tool_name, tool_input |
| PostToolUse | After any tool | tool_name, tool_input, tool_response |
| Stop | Session ends | Statistics |

### Why Hooks Work

- **Transport-agnostic** - Captures stdio, HTTP, built-in tools
- **Post-auth** - Runs after Claude handles authentication
- **No config changes per server** - One hook covers everything
- **Native integration** - Supported by Claude Code directly

### Hook Limitations (For Balance)

Hooks aren't perfect:

| Limitation | Impact |
|------------|--------|
| Synchronous execution | Adds latency to each tool call |
| Shell command overhead | ~10-50ms per invocation |
| No raw protocol visibility | Can't see MCP frame details |
| Error handling complexity | Hook failures need graceful handling |

For most observability use cases, these tradeoffs are acceptable.

---

## Lessons Learned

**1. Understand the ecosystem first.** We assumed HTTP dominance because that's how web APIs work. MCP evolved differently—local-first, process-based.

**2. OAuth blocking is a feature.** Our inability to proxy OAuth servers is a security success. Tokens should be opaque.

**3. Platform-native beats generic.** Claude Code's hooks provide better observability than any external proxy could.

**4. Learn by building, not just reading.** A few days of ideating and vibe-coding multiple approaches taught us more about MCP's real constraints than any architecture diagram or specification could.

---

## Conclusion

The "obvious" approach (HTTP proxy) conflicts with MCP's actual architecture (stdio-dominant, OAuth-protected). These constraints are deliberate design choices prioritizing security and local operation.

For teams building MCP observability:

1. **Use hooks for Claude Code**—it's the only complete solution
2. **Accept platform specificity**—each agent needs its own approach
3. **Don't fight the architecture**—work with it

---

*This documents our experience building [agent-recorder](https://github.com/EdytaKucharska/agent_recorder). We pivoted from proxy-based to hooks-based monitoring after discovering these constraints.*

## Further Reading

- [MCP Specification - Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [Why MCP Deprecated SSE for Streamable HTTP](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/)
- [mcp-proxy: stdio ↔ HTTP bridge](https://github.com/sparfenyuk/mcp-proxy)
