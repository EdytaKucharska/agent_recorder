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

  it("returns the same value as estimateSerializedTokens on its JSON form", () => {
    const value = { tool: "execute_sql", database: "prod" };
    const json = JSON.stringify(value);
    expect(estimateTokens(value)).toBe(estimateSerializedTokens(json));
  });

  it("returns 0 for null and undefined", () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("does NOT double-serialize an already-serialized string", () => {
    // estimateTokens on a raw object should equal estimateSerializedTokens
    // on the same object's JSON form (no double-serialization).
    const obj = { name: "test", value: 42 };
    const serialized = JSON.stringify(obj);
    const fromObject = estimateTokens(obj);
    const fromSerialized = estimateSerializedTokens(serialized);
    expect(fromObject).toBe(fromSerialized);
  });

  it("double-serializes when called with an already-serialized string (known behaviour)", () => {
    // estimateTokens accepts `unknown` and always calls JSON.stringify internally.
    // Callers with already-serialized strings should use estimateSerializedTokens()
    // directly to avoid this.
    const obj = { name: "test", value: 42 };
    const serialized = JSON.stringify(obj); // '{"name":"test","value":42}'
    const fromObject = estimateTokens(obj);
    const fromString = estimateTokens(serialized); // double-stringifies
    // Double-stringifying produces a larger (inflated) estimate
    expect(fromString).toBeGreaterThan(fromObject);
    // The correct approach for already-serialized strings
    expect(estimateSerializedTokens(serialized)).toBe(fromObject);
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
    expect(estimateTokens({})).toBe(estimateSerializedTokens("{}"));
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
