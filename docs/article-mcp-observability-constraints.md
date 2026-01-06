# Why Proxying MCP Traffic Is Harder Than You Think: Lessons from Building an Observability Tool for Claude Code

_A technical deep-dive into the constraints of MCP observability and why we pivoted from proxy-based to hooks-based monitoring._

---

## The Problem We Tried to Solve

As AI coding agents become mainstream, observability becomes critical. We wanted to answer simple questions:

- What tools did Claude Code use during this session?
- How long did each MCP call take?
- What data flowed between Claude and external services?

Our approach seemed straightforward: build an HTTP proxy that sits between Claude Code and MCP servers, recording all traffic. Simple, right?

**Wrong.**

After weeks of development and real-world testing, we discovered fundamental architectural constraints that made our proxy approach viable for only a tiny fraction of MCP servers. This article documents what we learned.

---

## Constraint 1: The stdio Transport Dominance

### What We Expected

MCP (Model Context Protocol) defines a standard for AI agents to communicate with external tools. We assumed most MCP servers would use HTTP—after all, that's how modern APIs work.

### What We Found

**The vast majority of MCP servers use stdio transport, not HTTP.**

| Transport           | How It Works                      | Proxy-able? |
| ------------------- | --------------------------------- | ----------- |
| **stdio**           | Local subprocess via stdin/stdout | ❌ No       |
| **HTTP/SSE**        | Remote HTTP endpoints             | ✅ Yes      |
| **Streamable HTTP** | Modern remote standard            | ✅ Yes      |

When you configure an MCP server like this:

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

Claude Code spawns a subprocess and communicates via stdin/stdout. There's no network traffic to intercept. The communication happens entirely within process streams.

### Why stdio Dominates

1. **Zero network overhead** - Direct process communication is faster
2. **Implicit security** - User launched both client and server
3. **Secrets stay local** - Environment variables never leave the machine
4. **npx/uvx convenience** - No installation required, just run

The MCP ecosystem evolved around local-first tooling. By the time we built our proxy, the battle was already lost—most servers were stdio-only.

---

## Constraint 2: The OAuth Authentication Wall

### What We Expected

For HTTP-based MCP servers (like Figma, Amplitude, Notion), we could configure our proxy as the endpoint and forward requests with the user's credentials.

### What We Found

**Most remote MCP servers use OAuth 2.0, and Claude Code manages tokens internally.**

When connecting to Figma's MCP server, this happens:

```
1. Claude Code → Figma OAuth → Browser consent screen
2. User clicks "Authorize"
3. Figma redirects to localhost:XXXXX/callback?code=...
4. Claude Code exchanges code for tokens
5. Claude Code stores tokens internally
6. Tokens are NEVER exposed in request headers
```

We tested this with multiple providers:

| Provider  | Transport | Auth Method | Proxy Works? |
| --------- | --------- | ----------- | ------------ |
| Figma     | HTTP      | OAuth 2.0   | ❌ No        |
| Amplitude | HTTP      | OAuth 2.0   | ❌ No        |
| Notion    | HTTP      | OAuth 2.0   | ❌ No        |

We even tried using Figma Personal Access Tokens (PATs) as a workaround. The result:

```bash
curl -X POST https://mcp.figma.com/mcp \
  -H "Authorization: Bearer figd_xxx..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'

# Response: Unauthorized
```

Figma's MCP endpoint only accepts OAuth tokens—PATs don't work. This is a deliberate security design, but it completely blocks proxy-based observability.

### The Token Lifecycle Problem

Even if we could intercept the initial OAuth flow, tokens expire and refresh. Claude Code handles this automatically. A proxy would need to:

1. Intercept the initial OAuth callback
2. Store refresh tokens securely
3. Handle token refresh transparently
4. Sync state with Claude Code's internal token store

This is architecturally complex and security-sensitive—essentially rebuilding Claude Code's auth system.

---

## Constraint 3: Configuration Complexity

### Multiple Config Files

Claude Code uses multiple configuration files:

- `~/.claude/settings.json` - Global settings
- `~/.claude.json` - Project-level settings (higher priority)
- MCP server configs can exist in either

When a user configures an MCP server in the project file, it bypasses global settings entirely. Our proxy setup in the global config was silently ignored.

### The "It Works on My Machine" Problem

During testing, we encountered:

- Proxy worked for some MCP servers, not others (transport differences)
- Same server worked in one project, failed in another (config precedence)
- OAuth servers showed no errors—just silent auth failures

Debugging required understanding Claude Code's config resolution, MCP transport selection, and OAuth state management simultaneously.

---

## Constraint 4: SSE Response Parsing

Even when we could reach HTTP MCP servers, response parsing proved tricky.

### The Problem

MCP over HTTP uses Server-Sent Events (SSE) for streaming responses:

```
event: message
data: {"jsonrpc":"2.0","result":{"tools":[...]},"id":1}

event: message
data: {"jsonrpc":"2.0","result":{"content":[...]},"id":2}
```

Different servers implement SSE differently:

- Some send multiple `data:` lines per event
- Some include `event:` prefixes, some don't
- Some stream incrementally, some batch

Our proxy had to handle all variations while maintaining JSON-RPC message integrity.

---

## What Actually Works (The Tiny Viable Subset)

After all our testing, here's what our proxy approach can reliably monitor:

### ✅ Works

1. **Self-hosted MCP servers** - You control the auth mechanism
2. **Servers with static API keys** - Rare, but some exist
3. **Internal/enterprise servers** - Custom auth you configure

### ❌ Doesn't Work

1. **stdio MCP servers** - ~80% of the ecosystem
2. **OAuth-protected servers** - Figma, Amplitude, Notion, etc.
3. **Any server where Claude manages auth**

---

## The Better Approach: Hooks

Claude Code provides a native hooks system that fires at lifecycle events:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/record-tool.sh"
          }
        ]
      }
    ]
  }
}
```

### What Hooks Capture

| Hook             | Trigger           | Data Available                       |
| ---------------- | ----------------- | ------------------------------------ |
| PreToolUse       | Before ANY tool   | tool_name, tool_input                |
| PostToolUse      | After ANY tool    | tool_name, tool_input, tool_response |
| Stop             | Agent completes   | Full transcript                      |
| SessionStart/End | Session lifecycle | Statistics                           |

### Why Hooks Work

1. **Transport-agnostic** - Captures stdio, HTTP, built-in tools
2. **Post-auth** - Runs after Claude handles authentication
3. **Native integration** - No proxy configuration needed
4. **Complete visibility** - Sees everything Claude sees

---

## Lessons Learned

### 1. Understand the Ecosystem Before Building

We assumed HTTP dominance because that's how web APIs work. MCP evolved differently—local-first, process-based, security-conscious.

### 2. OAuth Is a Feature, Not a Bug

OAuth-protected MCP servers are more secure precisely because tokens aren't exposed. Our inability to proxy them is a security success story.

### 3. Platform-Native Beats Generic

Claude Code's hooks system provides better observability than any proxy could. The platform knows more than an external observer ever could.

### 4. Fail Fast, Pivot Faster

We spent weeks on the proxy approach before accepting its limitations. Earlier testing with real OAuth servers would have revealed the constraints sooner.

---

## Conclusion

Building MCP observability taught us that the "obvious" approach (HTTP proxy) conflicts with MCP's actual architecture (stdio-dominant, OAuth-protected).

The constraints aren't bugs—they're deliberate design choices prioritizing security and local-first operation. Effective observability requires working with the platform (hooks, OpenTelemetry) rather than around it (proxies).

For teams building MCP observability tools:

1. **Use hooks** for Claude Code—it's the only complete solution
2. **Use OpenTelemetry** for metrics/traces—Claude Code exports natively
3. **Accept platform specificity**—each agent platform needs its own approach

The MCP ecosystem is young. As it matures, we may see standardized observability primitives. Until then, platform-native integration beats generic proxying every time.

---

_This article documents our experience building [agent-recorder](https://github.com/EdytaKucharska/agent_recorder), an observability tool for Claude Code. We pivoted from proxy-based to hooks-based monitoring after discovering the constraints described above._
