/**
 * Logger utility that adds timestamps to console output.
 * Automatically prefixes all console.log/error/warn calls with ISO 8601 timestamps.
 */

/**
 * Format a timestamp in ISO 8601 format with timezone.
 * Example: 2026-01-03T16:45:23.123Z
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Install timestamp logging by overriding console methods.
 * All subsequent console.log/error/warn calls will be prefixed with timestamps.
 */
export function installTimestampLogging(): void {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    originalLog(`[${formatTimestamp()}]`, ...args);
  };

  console.error = (...args: unknown[]) => {
    originalError(`[${formatTimestamp()}]`, ...args);
  };

  console.warn = (...args: unknown[]) => {
    originalWarn(`[${formatTimestamp()}]`, ...args);
  };
}
