/**
 * JSON-RPC 2.0 types for MCP protocol.
 * Shared between service and stdio-proxy packages.
 */

/** Base JSON-RPC request structure */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id?: string | number | null;
}

/** JSON-RPC success response */
export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  result: unknown;
  id: string | number | null;
}

/** JSON-RPC error response */
export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

/** Union of JSON-RPC response types */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** MCP tools/call request params */
export interface ToolsCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}
