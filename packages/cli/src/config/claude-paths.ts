/**
 * Claude Code configuration detection and management.
 * Re-exports from @agent-recorder/core to avoid duplication.
 */

export {
  type ClaudeConfigInfo,
  type McpServerEntry,
  getV2ConfigPath,
  getLegacyConfigPath,
  detectClaudeConfig,
  readJsonFile,
  writeJsonFileAtomic,
  createBackup,
  getMcpServerEntry,
  setMcpServerEntry,
  formatPath,
} from "@agent-recorder/core";
