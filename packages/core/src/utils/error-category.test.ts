/**
 * Tests for error category derivation.
 */

import { describe, it, expect } from "vitest";
import { deriveErrorCategory } from "./error-category.js";

describe("deriveErrorCategory", () => {
  describe("non-error statuses return null", () => {
    it("returns null for success status", () => {
      expect(deriveErrorCategory("success", null)).toBeNull();
    });

    it("returns null for running status", () => {
      expect(deriveErrorCategory("running", null)).toBeNull();
    });

    it("returns null for cancelled status", () => {
      expect(deriveErrorCategory("cancelled", null)).toBeNull();
    });
  });

  describe("timeout status", () => {
    it("returns downstream_timeout for timeout status regardless of output", () => {
      expect(deriveErrorCategory("timeout", null)).toBe("downstream_timeout");
    });

    it("returns downstream_timeout even with output present", () => {
      const output = JSON.stringify({ error: "some error" });
      expect(deriveErrorCategory("timeout", output)).toBe("downstream_timeout");
    });
  });

  describe("error status with JSON-RPC error codes", () => {
    it("returns downstream_unreachable for -32000 with connect in message", () => {
      const output = JSON.stringify({
        code: -32000,
        message: "Failed to connect to downstream",
      });
      expect(deriveErrorCategory("error", output)).toBe(
        "downstream_unreachable"
      );
    });

    it("returns jsonrpc_invalid for -32700 (Parse error)", () => {
      const output = JSON.stringify({
        code: -32700,
        message: "Parse error",
      });
      expect(deriveErrorCategory("error", output)).toBe("jsonrpc_invalid");
    });

    it("returns jsonrpc_invalid for -32600 (Invalid Request)", () => {
      const output = JSON.stringify({
        code: -32600,
        message: "Invalid Request",
      });
      expect(deriveErrorCategory("error", output)).toBe("jsonrpc_invalid");
    });

    it("returns jsonrpc_error for other JSON-RPC error codes", () => {
      const output = JSON.stringify({
        code: -32601,
        message: "Method not found",
      });
      expect(deriveErrorCategory("error", output)).toBe("jsonrpc_error");
    });

    it("returns jsonrpc_error for -32000 without connect in message", () => {
      const output = JSON.stringify({
        code: -32000,
        message: "Some other server error",
      });
      expect(deriveErrorCategory("error", output)).toBe("jsonrpc_error");
    });
  });

  describe("error status with unknown output", () => {
    it("returns unknown for null output", () => {
      expect(deriveErrorCategory("error", null)).toBe("unknown");
    });

    it("returns unknown for invalid JSON output", () => {
      expect(deriveErrorCategory("error", "not valid json")).toBe("unknown");
    });

    it("returns unknown for output without code field", () => {
      const output = JSON.stringify({ error: "Something went wrong" });
      expect(deriveErrorCategory("error", output)).toBe("unknown");
    });

    it("returns unknown for empty object", () => {
      expect(deriveErrorCategory("error", "{}")).toBe("unknown");
    });
  });

  describe("case insensitivity in message matching", () => {
    it("matches connect case-insensitively", () => {
      const output = JSON.stringify({
        code: -32000,
        message: "FAILED TO CONNECT",
      });
      expect(deriveErrorCategory("error", output)).toBe(
        "downstream_unreachable"
      );
    });
  });
});
