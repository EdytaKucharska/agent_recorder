/**
 * Provider types for Agent Recorder Hub.
 * Providers represent downstream MCP servers that the hub aggregates.
 */

/**
 * HTTP-based MCP provider (local or remote server via URL).
 */
export interface HttpProvider {
  id: string;
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

/**
 * Stdio-based MCP provider (process spawned via command).
 * Runtime spawning not implemented yet - type system only.
 */
export interface StdioProvider {
  id: string;
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Union type for all supported provider kinds.
 */
export type Provider = HttpProvider | StdioProvider;

/**
 * Providers file schema (stable, versioned).
 */
export interface ProvidersFile {
  version: 1;
  providers: Provider[];
}
