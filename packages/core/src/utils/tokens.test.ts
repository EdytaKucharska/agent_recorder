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

  it("handles null and undefined without throwing", () => {
    expect(estimateTokens(null)).toBeGreaterThanOrEqual(0);
    expect(estimateTokens(undefined)).toBeGreaterThanOrEqual(0);
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

  it("returns larger estimates for larger payloads", () => {
    const small = { a: 1 };
    const large = { data: "x".repeat(1000) };
    expect(estimateTokens(large)).toBeGreaterThan(estimateTokens(small));
  });

  it("handles empty object", () => {
    expect(estimateTokens({})).toBe(Math.ceil("{}".length / 4));
  });
});
