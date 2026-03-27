/**
 * Cost estimation using static pricing config.
 * All results are labeled "estimated_" — not guaranteed accurate.
 */

import { loadPricingConfig } from "./config.js";

export interface CostEstimate {
  estimatedInputCostUsd: number;
  estimatedOutputCostUsd: number;
  estimatedTotalCostUsd: number;
}

/**
 * Estimate cost for a given token count and model.
 * Falls back to the default_model rate when the model is unknown.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  modelKey?: string | null
): CostEstimate {
  const config = loadPricingConfig();
  const key = modelKey ?? config.default_model;
  const pricing = config.models[key] ??
    config.models[config.default_model] ?? {
      input_per_mtok: 3.0,
      output_per_mtok: 15.0,
    };

  const estimatedInputCostUsd =
    (inputTokens / 1_000_000) * pricing.input_per_mtok;
  const estimatedOutputCostUsd =
    (outputTokens / 1_000_000) * pricing.output_per_mtok;

  return {
    estimatedInputCostUsd:
      Math.round(estimatedInputCostUsd * 1_000_000) / 1_000_000,
    estimatedOutputCostUsd:
      Math.round(estimatedOutputCostUsd * 1_000_000) / 1_000_000,
    estimatedTotalCostUsd:
      Math.round((estimatedInputCostUsd + estimatedOutputCostUsd) * 1_000_000) /
      1_000_000,
  };
}
