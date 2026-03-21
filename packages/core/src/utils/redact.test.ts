/**
 * Tests for redaction and truncation utilities,
 * including non-serializable edge cases.
 */

import { describe, it, expect } from "vitest";
import { redactJson, truncateJson, redactAndTruncate } from "./redact.js";

describe("redactJson", () => {
  it("redacts matching keys case-insensitively", () => {
    const result = redactJson(
      { token: "secret", Token: "also-secret", safe: "ok" },
      ["token"]
    );
    expect(result).toEqual({
      token: "[REDACTED]",
      Token: "[REDACTED]",
      safe: "ok",
    });
  });

  it("handles null and undefined", () => {
    expect(redactJson(null, ["key"])).toBeNull();
    expect(redactJson(undefined, ["key"])).toBeUndefined();
  });

  it("handles arrays", () => {
    const result = redactJson([{ password: "x" }, { safe: "y" }], ["password"]);
    expect(result).toEqual([{ password: "[REDACTED]" }, { safe: "y" }]);
  });

  it("handles primitive values", () => {
    expect(redactJson("hello", ["key"])).toBe("hello");
    expect(redactJson(42, ["key"])).toBe(42);
    expect(redactJson(true, ["key"])).toBe(true);
  });
});

describe("truncateJson", () => {
  it("does not truncate short values", () => {
    const result = truncateJson({ a: 1 });
    expect(result).toBe('{"a":1}');
  });

  it("truncates long values with indicator", () => {
    const long = { data: "x".repeat(20000) };
    const result = truncateJson(long, 100);
    expect(result.length).toBe(100);
    expect(result).toMatch(/\.\.\.\[TRUNCATED\]$/);
  });
});

describe("redactAndTruncate", () => {
  it("returns a string", () => {
    const result = redactAndTruncate({ key: "value" }, []);
    expect(typeof result).toBe("string");
  });

  it("redacts and truncates in one step", () => {
    const result = redactAndTruncate({ password: "secret", data: "ok" }, [
      "password",
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.password).toBe("[REDACTED]");
    expect(parsed.data).toBe("ok");
  });

  it("handles circular references by throwing", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    // JSON.stringify throws on circular refs; redactAndTruncate should propagate
    expect(() => redactAndTruncate(circular, [])).toThrow();
  });

  it("handles BigInt by throwing", () => {
    const withBigInt = { value: BigInt(123) };
    // JSON.stringify throws on BigInt; redactAndTruncate should propagate
    expect(() => redactAndTruncate(withBigInt, [])).toThrow();
  });

  it("handles Symbol values (dropped by JSON.stringify)", () => {
    const withSymbol = { sym: Symbol("test"), safe: "ok" };
    const result = redactAndTruncate(withSymbol, []);
    const parsed = JSON.parse(result);
    // Symbols are dropped by JSON.stringify
    expect(parsed.sym).toBeUndefined();
    expect(parsed.safe).toBe("ok");
  });

  it("handles undefined values (dropped by JSON.stringify)", () => {
    const withUndefined = { undef: undefined, safe: "ok" };
    const result = redactAndTruncate(withUndefined, []);
    const parsed = JSON.parse(result);
    expect("undef" in parsed).toBe(false);
    expect(parsed.safe).toBe("ok");
  });
});
