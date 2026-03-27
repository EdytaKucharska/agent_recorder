/**
 * Pricing configuration loader.
 * Loads static pricing.json from AR_PRICING_PATH or .storage/pricing.json.
 * Cached in memory after first load.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
}

export interface PricingConfig {
  models: Record<string, ModelPricing>;
  default_model: string;
}

/** Built-in fallback pricing (Anthropic models, March 2026) */
const DEFAULT_PRICING: PricingConfig = {
  models: {
    "claude-opus-4-6": { input_per_mtok: 15.0, output_per_mtok: 75.0 },
    "claude-sonnet-4-6": { input_per_mtok: 3.0, output_per_mtok: 15.0 },
    "claude-haiku-4-5": { input_per_mtok: 0.8, output_per_mtok: 4.0 },
    "claude-sonnet-4": { input_per_mtok: 3.0, output_per_mtok: 15.0 },
    "claude-haiku-4": { input_per_mtok: 0.8, output_per_mtok: 4.0 },
  },
  default_model: "claude-sonnet-4-6",
};

let cached: PricingConfig | null = null;

/** Load pricing from file, falling back to built-in defaults. Cached after first call. */
export function loadPricingConfig(): PricingConfig {
  if (cached) return cached;

  const pricingPath =
    process.env["AR_PRICING_PATH"] ??
    join(process.cwd(), ".storage", "pricing.json");

  if (existsSync(pricingPath)) {
    try {
      const raw = readFileSync(pricingPath, "utf-8");
      const parsed = JSON.parse(raw) as PricingConfig;
      if (parsed.models && parsed.default_model) {
        cached = parsed;
        return cached;
      }
    } catch {
      // Malformed file — fall through to defaults
    }
  }

  cached = DEFAULT_PRICING;
  return cached;
}

/** For testing: reset the cache */
export function resetPricingCache(): void {
  cached = null;
}
