import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCsrfOriginGuard } from "../../src/lib/security/csrf-origin-guard";
import { LoginAbusePolicy } from "../../src/lib/security/login-abuse-policy";
import {
  buildSecurityHeaders,
  DEFAULT_SECURITY_HEADERS_CONFIG,
} from "../../src/lib/security/security-headers";

const mockCookieSet = vi.hoisted(() => vi.fn());
const mockCookies = vi.hoisted(() => vi.fn());
const mockGetRedisClient = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: mockCookies,
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/config/config", () => ({
  config: {
    auth: {
      adminToken: "test-admin-token",
    },
  },
}));

vi.mock("@/repository/key", () => ({
  findKeyList: vi.fn(),
  validateApiKeyAndGetUser: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: mockGetRedisClient,
}));

const ORIGINAL_SESSION_TOKEN_MODE = process.env.SESSION_TOKEN_MODE;
const ORIGINAL_ENABLE_SECURE_COOKIES = process.env.ENABLE_SECURE_COOKIES;

function restoreAuthEnv() {
  if (ORIGINAL_SESSION_TOKEN_MODE === undefined) {
    delete process.env.SESSION_TOKEN_MODE;
  } else {
    process.env.SESSION_TOKEN_MODE = ORIGINAL_SESSION_TOKEN_MODE;
  }

  if (ORIGINAL_ENABLE_SECURE_COOKIES === undefined) {
    delete process.env.ENABLE_SECURE_COOKIES;
  } else {
    process.env.ENABLE_SECURE_COOKIES = ORIGINAL_ENABLE_SECURE_COOKIES;
  }
}

function setupCookieStoreMock() {
  mockCookieSet.mockClear();
  mockCookies.mockResolvedValue({
    set: mockCookieSet,
    get: vi.fn(),
    delete: vi.fn(),
  });
}

class FakeRedisClient {
  status: "ready" = "ready";
  private readonly values = new Map<string, string>();

  async setex(key: string, _ttl: number, value: string): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

describe("Full Security Regression Suite", () => {
  beforeEach(() => {
    setupCookieStoreMock();
  });

  afterEach(() => {
    restoreAuthEnv();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("Session Contract", () => {
    it("SESSION_TOKEN_MODE defaults to opaque", async () => {
      delete process.env.SESSION_TOKEN_MODE;

      vi.resetModules();
      const { getSessionTokenMode } = await import("../../src/lib/auth");

      expect(getSessionTokenMode()).toBe("opaque");
    });

    it("OpaqueSessionContract has required fields", async () => {
      vi.resetModules();
      const { isOpaqueSessionContract } = await import("../../src/lib/auth");

      const contract = {
        sessionId: "sid_opaque_session_123",
        keyFingerprint: "sha256:abc123",
        createdAt: 1_700_000_000,
        expiresAt: 1_700_000_300,
        userId: 42,
        userRole: "admin",
      };

      expect(isOpaqueSessionContract(contract)).toBe(true);

      const missingUserRole = { ...contract } as Partial<typeof contract>;
      delete missingUserRole.userRole;
      expect(isOpaqueSessionContract(missingUserRole)).toBe(false);
    });
  });

  describe("Session Store", () => {
    it("create returns valid session data", async () => {
      const redis = new FakeRedisClient();
      mockGetRedisClient.mockReturnValue(redis);
      const { RedisSessionStore } = await import(
        "../../src/lib/auth-session-store/redis-session-store"
      );

      const store = new RedisSessionStore();

      const created = await store.create({
        keyFingerprint: "sha256:fp-1",
        userId: 101,
        userRole: "user",
      });

      expect(created.sessionId).toMatch(/^sid_[0-9a-f-]{36}$/i);
      expect(created.keyFingerprint).toBe("sha256:fp-1");
      expect(created.userId).toBe(101);
      expect(created.userRole).toBe("user");
      expect(created.expiresAt).toBeGreaterThan(created.createdAt);
      await expect(store.read(created.sessionId)).resolves.toEqual(created);
    });

    it("read returns null for non-existent session", async () => {
      const redis = new FakeRedisClient();
      mockGetRedisClient.mockReturnValue(redis);
      const { RedisSessionStore } = await import(
        "../../src/lib/auth-session-store/redis-session-store"
      );

      const store = new RedisSessionStore();

      await expect(store.read("missing-session")).resolves.toBeNull();
    });
  });

  describe("Cookie Hardening", () => {
    it("auth cookie is HttpOnly", async () => {
      process.env.ENABLE_SECURE_COOKIES = "true";

      vi.resetModules();
      const { AUTH_COOKIE_NAME, setAuthCookie } = await import("../../src/lib/auth");

      await setAuthCookie("test-key");

      expect(mockCookieSet).toHaveBeenCalledTimes(1);
      const [name, value, options] = mockCookieSet.mock.calls[0];
      expect(name).toBe(AUTH_COOKIE_NAME);
      expect(value).toBe("test-key");
      expect(options.httpOnly).toBe(true);
    });

    it("auth cookie secure flag matches env", async () => {
      const cases = [
        { envValue: "true", expected: true },
        { envValue: "false", expected: false },
      ] as const;

      for (const testCase of cases) {
        mockCookieSet.mockClear();
        process.env.ENABLE_SECURE_COOKIES = testCase.envValue;

        vi.resetModules();
        const { setAuthCookie } = await import("../../src/lib/auth");
        await setAuthCookie("env-test");

        const [, , options] = mockCookieSet.mock.calls[0];
        expect(options.secure).toBe(testCase.expected);
      }
    });
  });

  describe("Anti-Bruteforce", () => {
    it("blocks after threshold", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-18T10:00:00.000Z"));

      const policy = new LoginAbusePolicy({ maxAttemptsPerIp: 2, lockoutSeconds: 60 });
      const ip = "198.51.100.10";

      policy.recordFailure(ip);
      policy.recordFailure(ip);

      const decision = policy.check(ip);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("ip_rate_limited");
      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("resets on success", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-18T10:00:00.000Z"));

      const policy = new LoginAbusePolicy({ maxAttemptsPerIp: 2, lockoutSeconds: 60 });
      const ip = "198.51.100.11";

      policy.recordFailure(ip);
      policy.recordFailure(ip);
      expect(policy.check(ip).allowed).toBe(false);

      policy.recordSuccess(ip);
      expect(policy.check(ip)).toEqual({ allowed: true });
    });
  });

  describe("CSRF Guard", () => {
    it("allows same-origin", () => {
      const guard = createCsrfOriginGuard({
        allowedOrigins: ["https://safe.example.com"],
        allowSameOrigin: true,
        enforceInDevelopment: true,
      });

      const result = guard.check({
        headers: new Headers({
          "sec-fetch-site": "same-origin",
        }),
      });

      expect(result).toEqual({ allowed: true });
    });

    it("blocks cross-origin", () => {
      const guard = createCsrfOriginGuard({
        allowedOrigins: ["https://safe.example.com"],
        allowSameOrigin: true,
        enforceInDevelopment: true,
      });

      const result = guard.check({
        headers: new Headers({
          "sec-fetch-site": "cross-site",
          origin: "https://evil.example.com",
        }),
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Origin https://evil.example.com not in allowlist");
    });
  });

  describe("Security Headers", () => {
    it("includes all required headers", () => {
      const headers = buildSecurityHeaders();

      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe(DEFAULT_SECURITY_HEADERS_CONFIG.frameOptions);
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["X-DNS-Prefetch-Control"]).toBe("off");
      expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    });

    it("CSP report-only by default", () => {
      expect(DEFAULT_SECURITY_HEADERS_CONFIG.cspMode).toBe("report-only");

      const headers = buildSecurityHeaders();
      expect(headers["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
      expect(headers["Content-Security-Policy"]).toBeUndefined();
    });
  });
});
