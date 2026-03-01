import { describe, expect, it } from "vitest";
import {
  resolveLoginRedirectTarget,
  sanitizeRedirectPath,
} from "@/app/[locale]/login/redirect-safety";
import { getLoginRedirectTarget } from "@/lib/auth";

describe("sanitizeRedirectPath", () => {
  it("keeps safe relative path /settings", () => {
    expect(sanitizeRedirectPath("/settings")).toBe("/settings");
  });

  it("keeps safe nested path /dashboard/users", () => {
    expect(sanitizeRedirectPath("/dashboard/users")).toBe("/dashboard/users");
  });

  it("rejects absolute external URL", () => {
    expect(sanitizeRedirectPath("https://evil.example/phish")).toBe("/dashboard");
  });

  it("rejects protocol-relative URL", () => {
    expect(sanitizeRedirectPath("//evil.example")).toBe("/dashboard");
  });

  it("rejects empty string", () => {
    expect(sanitizeRedirectPath("")).toBe("/dashboard");
  });

  it("keeps relative path with query string", () => {
    expect(sanitizeRedirectPath("/settings?tab=general")).toBe("/settings?tab=general");
  });

  it("rejects protocol-like path payload", () => {
    expect(sanitizeRedirectPath("/https://evil.example/path")).toBe("/dashboard");
  });
});

describe("resolveLoginRedirectTarget", () => {
  it("always prioritizes server redirectTo over from", () => {
    expect(resolveLoginRedirectTarget("/my-usage", "/settings")).toBe("/my-usage");
    expect(resolveLoginRedirectTarget("/my-usage", "https://evil.example/phish")).toBe("/my-usage");
  });

  it("uses sanitized from when server redirectTo is empty", () => {
    expect(resolveLoginRedirectTarget(undefined, "/settings")).toBe("/settings");
    expect(resolveLoginRedirectTarget("", "https://evil.example/phish")).toBe("/dashboard");
  });
});

describe("getLoginRedirectTarget invariants", () => {
  it("routes admin user to /dashboard", () => {
    expect(
      getLoginRedirectTarget({
        user: { role: "admin" } as any,
        key: { canLoginWebUi: false } as any,
      })
    ).toBe("/dashboard");
  });

  it("routes canLoginWebUi user to /dashboard", () => {
    expect(
      getLoginRedirectTarget({
        user: { role: "user" } as any,
        key: { canLoginWebUi: true } as any,
      })
    ).toBe("/dashboard");
  });

  it("routes readonly user to /my-usage", () => {
    expect(
      getLoginRedirectTarget({
        user: { role: "user" } as any,
        key: { canLoginWebUi: false } as any,
      })
    ).toBe("/my-usage");
  });
});
