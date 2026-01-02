/**
 * I/O utilities for providers registry.
 * Handles reading/writing providers.json file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProvidersFile, Provider } from "./types.js";

/**
 * Get the default path for providers.json.
 * Returns ~/.agent-recorder/providers.json
 */
export function getDefaultProvidersPath(): string {
  return path.join(os.homedir(), ".agent-recorder", "providers.json");
}

/**
 * Read providers file from disk.
 * Returns empty providers list if file doesn't exist or is invalid.
 *
 * @param filePath - Path to providers.json (defaults to ~/.agent-recorder/providers.json)
 */
export function readProvidersFile(filePath?: string): ProvidersFile {
  const targetPath = filePath ?? getDefaultProvidersPath();

  try {
    if (!fs.existsSync(targetPath)) {
      return { version: 1, providers: [] };
    }

    const content = fs.readFileSync(targetPath, "utf-8");
    const parsed = JSON.parse(content) as ProvidersFile;

    // Validate version and providers array
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.providers)
    ) {
      console.warn(
        `[Providers] Invalid file format at ${targetPath}, returning empty`
      );
      return { version: 1, providers: [] };
    }

    return parsed;
  } catch (error) {
    console.warn(
      `[Providers] Failed to read ${targetPath}:`,
      error instanceof Error ? error.message : "Unknown error"
    );
    return { version: 1, providers: [] };
  }
}

/**
 * Write providers file to disk.
 * Creates parent directory if needed.
 * Writes pretty-printed JSON with 2-space indent.
 *
 * @param file - Providers file to write
 * @param filePath - Path to providers.json (defaults to ~/.agent-recorder/providers.json)
 */
export function writeProvidersFile(
  file: ProvidersFile,
  filePath?: string
): void {
  const targetPath = filePath ?? getDefaultProvidersPath();
  const dir = path.dirname(targetPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write pretty-printed JSON with 2-space indent
  const content = JSON.stringify(file, null, 2) + "\n";
  fs.writeFileSync(targetPath, content, "utf-8");
}

/**
 * Upsert providers into a providers file.
 * Merges providers by provider.id - replaces if exists, adds if new.
 *
 * @param file - Existing providers file
 * @param providers - Providers to upsert
 * @returns New providers file with merged providers
 */
export function upsertProviders(
  file: ProvidersFile,
  providers: Provider[]
): ProvidersFile {
  const existingMap = new Map<string, Provider>();

  // Build map of existing providers
  for (const provider of file.providers) {
    existingMap.set(provider.id, provider);
  }

  // Upsert new providers
  for (const provider of providers) {
    existingMap.set(provider.id, provider);
  }

  // Convert back to array
  const mergedProviders = Array.from(existingMap.values());

  return {
    version: 1,
    providers: mergedProviders,
  };
}
