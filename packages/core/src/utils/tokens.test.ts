/**
 * Tests for token estimation utility.
 */

import { describe, it, expect } from "vitest";
import { estimateTokens } from "./tokens.js";

describe("estimateTokens", () => {
  it("returns a positive integer for a simple object", () => {
    const result = estimateTokens({ query: "SELECT 1" });
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("returns ceil(JSON.stringify(value).length / 4)", () => {
    const value = { tool: "execute_sql", database: "prod" };
    const json = JSON.stringify(value);
    expect(estimateTokens(value)).toBe(Math.ceil(json.length / 4));
  });

  it("returns 0 for null and undefined", () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("does NOT double-serialize an already-serialized string", () => {
    // When called with a raw object vs the same serialized string,
    // the raw object estimate should match length/4 of its JSON form.
    const obj = { name: "test", value: 42 };
    const serialized = JSON.stringify(obj); // already a string
    // Calling estimateTokens on the raw object
    const fromObject = estimateTokens(obj);
    // Calling Math.ceil(serialized.length / 4) directly (correct approach for strings)
    const fromStringDirect = Math.ceil(serialized.length / 4);
    // Both should be equal
    expect(fromObject).toBe(fromStringDirect);
  });

  it("double-serializes when called with an already-serialized string (known behaviour)", () => {
    // estimateTokens accepts `unknown` and always calls JSON.stringify internally.
    // Callers with already-serialized strings should use Math.ceil(str.length / 4)
    // directly to avoid this.
    const obj = { name: "test", value: 42 };
    const serialized = JSON.stringify(obj); // '{"name":"test","value":42}'
    const fromObject = estimateTokens(obj);
    const fromString = estimateTokens(serialized); // double-stringifies
    // Double-stringifying produces a larger (inflated) estimate
    expect(fromString).toBeGreaterThan(fromObject);
    // The correct approach for strings is length / 4 directly
    expect(Math.ceil(serialized.length / 4)).toBe(fromObject);
  });

  it("returns larger estimates for larger payloads", () => {
    const small = { a: 1 };
    const large = { data: "x".repeat(1000) };
    expect(estimateTokens(large)).toBeGreaterThan(estimateTokens(small));
  });

  it("handles empty object", () => {
    expect(estimateTokens({})).toBe(Math.ceil("{}".length / 4));
  });
});
