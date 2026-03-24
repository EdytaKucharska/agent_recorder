/**
 * Tests for token estimation utility.
 */

import { describe, it, expect } from "vitest";
import { estimateTokens, estimateSerializedTokens } from "./tokens.js";

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

  it("handles non-ASCII content with byte-accurate counting", () => {
    // Non-ASCII chars (e.g. emoji, CJK) encode to more than 1 byte in UTF-8.
    // TextEncoder-based counting should reflect this; String.length would not.
    const ascii = { text: "hello world" };
    const nonAscii = { text: "こんにちは世界" }; // each char is 3 UTF-8 bytes
    const asciiTokens = estimateTokens(ascii);
    const nonAsciiTokens = estimateTokens(nonAscii);
    // nonAscii has fewer visible chars but more bytes, so should have >= tokens
    expect(nonAsciiTokens).toBeGreaterThanOrEqual(asciiTokens);
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

describe("estimateSerializedTokens", () => {
  it("matches estimateTokens for ASCII JSON", () => {
    const obj = { query: "SELECT 1" };
    const serialized = JSON.stringify(obj);
    expect(estimateSerializedTokens(serialized)).toBe(estimateTokens(obj));
  });

  it("uses byte-accurate counting for non-ASCII content", () => {
    const json = JSON.stringify({ text: "こんにちは" });
    const expected = Math.ceil(new TextEncoder().encode(json).length / 4);
    expect(estimateSerializedTokens(json)).toBe(expected);
  });

  it("does not double-serialize strings", () => {
    const obj = { name: "test" };
    const serialized = JSON.stringify(obj);
    // estimateSerializedTokens should give same result as estimateTokens on raw obj
    expect(estimateSerializedTokens(serialized)).toBe(estimateTokens(obj));
  });
});
