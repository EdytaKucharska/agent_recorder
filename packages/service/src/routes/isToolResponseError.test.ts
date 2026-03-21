/**
 * Direct unit tests for isToolResponseError.
 *
 * Complements the integration tests in hooks.test.ts which test this
 * function indirectly via PostToolUse status derivation.
 */

import { describe, it, expect } from "vitest";
import { isToolResponseError } from "./hooks.js";

describe("isToolResponseError", () => {
  // --- MCP isError field (primary signal) ---

  it("returns true for { isError: true }", () => {
    expect(isToolResponseError({ isError: true })).toBe(true);
  });

  it("returns false for { isError: false }", () => {
    expect(isToolResponseError({ isError: false })).toBe(false);
  });

  it("returns false for { isError: 'true' } (string, not boolean)", () => {
    expect(isToolResponseError({ isError: "true" })).toBe(false);
  });

  it("returns true for { isError: true, error: '' } (isError takes precedence)", () => {
    expect(isToolResponseError({ isError: true, error: "" })).toBe(true);
  });

  // --- Top-level error field (heuristic fallback) ---

  it("returns true for { error: 'something went wrong' }", () => {
    expect(isToolResponseError({ error: "something went wrong" })).toBe(true);
  });

  it("returns false for { error: '' } (empty string)", () => {
    expect(isToolResponseError({ error: "" })).toBe(false);
  });

  it("returns false for { error: null }", () => {
    expect(isToolResponseError({ error: null })).toBe(false);
  });

  it("returns true for { error: { code: 123, message: 'fail' } }", () => {
    expect(
      isToolResponseError({ error: { code: 123, message: "fail" } })
    ).toBe(true);
  });

  it("returns false for { error: 42 } (number, not string or object)", () => {
    expect(isToolResponseError({ error: 42 })).toBe(false);
  });

  it("returns false for { error: true } (boolean, not string or object)", () => {
    expect(isToolResponseError({ error: true })).toBe(false);
  });

  // --- Non-error responses ---

  it("returns false for null", () => {
    expect(isToolResponseError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isToolResponseError(undefined)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(isToolResponseError("just a string")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isToolResponseError(42)).toBe(false);
  });

  it("returns false for an array", () => {
    expect(isToolResponseError([{ error: "nested" }])).toBe(false);
  });

  it("returns false for an empty object", () => {
    expect(isToolResponseError({})).toBe(false);
  });

  it("returns false for { result: 'ok' } (no error indicators)", () => {
    expect(isToolResponseError({ result: "ok" })).toBe(false);
  });
});
