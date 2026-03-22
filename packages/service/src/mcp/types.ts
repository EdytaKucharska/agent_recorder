/**
 * JSON-RPC 2.0 types and helpers for MCP protocol.
 * Types are re-exported from @agent-recorder/types.
 */

export type {
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcResponse,
  ToolsCallParams,
} from "@agent-recorder/types";

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcErrorResponse,
  ToolsCallParams,
} from "@agent-recorder/types";

/** Check if a JSON-RPC request is a tools/call request */
export function isToolsCallRequest(
  request: JsonRpcRequest
): request is JsonRpcRequest & { params: ToolsCallParams } {
  return (
    request.method === "tools/call" &&
    typeof request.params === "object" &&
    request.params !== null &&
    "name" in request.params
  );
}

/** Check if a JSON-RPC response is an error response */
export function isErrorResponse(
  response: JsonRpcResponse
): response is JsonRpcErrorResponse {
  return "error" in response;
}
