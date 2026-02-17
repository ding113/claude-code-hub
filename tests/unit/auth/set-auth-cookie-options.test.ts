import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCookieSet = vi.hoisted(() => vi.fn());
const mockCookies = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: mockCookies,
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

vi.mock("@/lib/config/config", () => ({ config: { auth: { adminToken: "test" } } }));
vi.mock("@/repository/key", () => ({ validateApiKeyAndGetUser: vi.fn() }));

import { setAuthCookie } from "@/lib/auth";

describe("setAuthCookie options", () => {
  beforeEach(() => {
    mockCookieSet.mockClear();
    mockCookies.mockResolvedValue({ set: mockCookieSet, get: vi.fn(), delete: vi.fn() });
  });

  describe("when ENABLE_SECURE_COOKIES is true", () => {
    beforeEach(() => {
      mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
    });

    it("sets secure=true", async () => {
      await setAuthCookie("test-key-123");

      expect(mockCookieSet).toHaveBeenCalledTimes(1);
      const [, , options] = mockCookieSet.mock.calls[0];
      expect(options.secure).toBe(true);
    });
  });

  describe("when ENABLE_SECURE_COOKIES is false", () => {
    beforeEach(() => {
      mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });
    });

    it("sets secure=false", async () => {
      await setAuthCookie("test-key-456");

      expect(mockCookieSet).toHaveBeenCalledTimes(1);
      const [, , options] = mockCookieSet.mock.calls[0];
      expect(options.secure).toBe(false);
    });
  });

  describe("invariant cookie options", () => {
    beforeEach(() => {
      mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
    });

    it("always sets httpOnly to true", async () => {
      await setAuthCookie("any-key");

      const [, , options] = mockCookieSet.mock.calls[0];
      expect(options.httpOnly).toBe(true);
    });

    it("always sets sameSite to lax", async () => {
      await setAuthCookie("any-key");

      const [, , options] = mockCookieSet.mock.calls[0];
      expect(options.sameSite).toBe("lax");
    });

    it("always sets maxAge to 7 days (604800 seconds)", async () => {
      await setAuthCookie("any-key");

      const [, , options] = mockCookieSet.mock.calls[0];
      expect(options.maxAge).toBe(604800);
    });

    it("always sets path to /", async () => {
      await setAuthCookie("any-key");

      const [, , options] = mockCookieSet.mock.calls[0];
      expect(options.path).toBe("/");
    });
  });

  describe("cookie name and value", () => {
    beforeEach(() => {
      mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
    });

    it("sets cookie name to auth-token", async () => {
      await setAuthCookie("my-secret-key");

      const [name] = mockCookieSet.mock.calls[0];
      expect(name).toBe("auth-token");
    });

    it("sets cookie value to the provided keyString", async () => {
      await setAuthCookie("my-secret-key");

      const [, value] = mockCookieSet.mock.calls[0];
      expect(value).toBe("my-secret-key");
    });
  });
});
