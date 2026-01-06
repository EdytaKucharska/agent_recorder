/**
 * @agent-recorder/stdio-proxy
 *
 * STDIO proxy for MCP server observability.
 * Wraps any MCP server and records all stdin/stdout traffic.
 */

export { StdioProxy } from "./proxy.js";
export type {
  ProxyOptions,
  ProxyState,
  McpMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";
