import { describe, expect, it } from "vitest";
import { resolveBindHost } from "./mcp-server.js";

describe("resolveBindHost", () => {
  it("defaults to loopback with no warning", () => {
    expect(resolveBindHost(undefined)).toEqual({ host: "127.0.0.1" });
  });

  it("accepts loopback-equivalent hosts silently", () => {
    for (const host of [
      "127.0.0.1",
      "localhost",
      "::1",
      "0:0:0:0:0:0:0:1",
      "::ffff:127.0.0.1",
      "127.0.0.2",
      "127.255.255.254",
      "::ffff:127.0.0.2",
    ]) {
      expect(resolveBindHost(host)).toEqual({ host });
    }
  });

  it("warns on non-loopback addresses that merely resemble loopback", () => {
    for (const host of ["127.0.0.1.evil.example", "1127.0.0.1", "0.0.0.0"]) {
      expect(resolveBindHost(host).warning).toMatch(/no authentication/);
    }
  });

  it("keeps an explicit wide bind but warns about missing authentication", () => {
    const { host, warning } = resolveBindHost("0.0.0.0");
    expect(host).toBe("0.0.0.0");
    expect(warning).toMatch(/no authentication/);
  });
});
