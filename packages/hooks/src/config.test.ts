import { describe, expect, it } from "vitest";
import { DEFAULT_HOOK_TIMEOUT_MS, resolveHookTimeoutMs } from "./config.js";

describe("resolveHookTimeoutMs", () => {
  it("defaults when unset", () => {
    expect(resolveHookTimeoutMs(undefined)).toBe(DEFAULT_HOOK_TIMEOUT_MS);
  });

  it("uses a valid positive value", () => {
    expect(resolveHookTimeoutMs("1200")).toBe(1200);
  });

  it("rounds fractional values up", () => {
    expect(resolveHookTimeoutMs("10.4")).toBe(11);
  });

  it("falls back on negative values instead of aborting instantly", () => {
    expect(resolveHookTimeoutMs("-100")).toBe(DEFAULT_HOOK_TIMEOUT_MS);
  });

  it("falls back on zero (the wait is always bounded)", () => {
    expect(resolveHookTimeoutMs("0")).toBe(DEFAULT_HOOK_TIMEOUT_MS);
  });

  it("falls back on non-numeric and non-finite values", () => {
    expect(resolveHookTimeoutMs("abc")).toBe(DEFAULT_HOOK_TIMEOUT_MS);
    expect(resolveHookTimeoutMs("Infinity")).toBe(DEFAULT_HOOK_TIMEOUT_MS);
    expect(resolveHookTimeoutMs("")).toBe(DEFAULT_HOOK_TIMEOUT_MS);
  });
});
