/**
 * Regression coverage for the auth guard's handling of account-state failures:
 * key disabled, key expired, user disabled, user expired.
 *
 * Each scenario must:
 *  - return HTTP 401 (NOT 429 — these are not rate-limit violations)
 *  - return a distinct, machine-readable error type
 *  - NOT call `recordFailure` on the brute-force rate limiter, since admin
 *    actions should not lock out the legitimate operator behind the key
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveApiKeyAuthOutcome = vi.hoisted(() => vi.fn());
const policyCheck = vi.hoisted(() => vi.fn());
const policyRecordSuccess = vi.hoisted(() => vi.fn());
const policyRecordFailure = vi.hoisted(() => vi.fn());
const markUserExpired = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/repository/key", () => ({
  resolveApiKeyAuthOutcome,
}));

vi.mock("@/repository/user", () => ({
  markUserExpired,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/security/login-abuse-policy", () => ({
  LoginAbusePolicy: class {
    check = policyCheck;
    recordSuccess = policyRecordSuccess;
    recordFailure = policyRecordFailure;
  },
}));

function makeSession(ip: string, apiKey: string) {
  return {
    headers: new Headers({
      "x-real-ip": ip,
      "x-api-key": apiKey,
    }),
    requestUrl: new URL("http://localhost/v1/messages"),
    clientIp: null as string | null,
    authState: null as unknown,
    setAuthState(state: unknown) {
      this.authState = state;
    },
  };
}

async function readErrorBody(response: Response) {
  const json = (await response.clone().json()) as {
    error: { message: string; type: string; code: string };
  };
  return json.error;
}

describe("ProxyAuthenticator account-state failures", () => {
  beforeEach(() => {
    vi.resetModules();
    resolveApiKeyAuthOutcome.mockReset();
    policyCheck.mockReset().mockReturnValue({ allowed: true });
    policyRecordSuccess.mockReset();
    policyRecordFailure.mockReset();
    // vitest config sets mockReset: true globally, which wipes the
    // mockResolvedValue from the hoisted setup. Re-apply per-test.
    markUserExpired.mockReset().mockResolvedValue(undefined);
  });

  it("disabled key returns 401 key_disabled and does NOT count toward rate limit", async () => {
    resolveApiKeyAuthOutcome.mockResolvedValue({ ok: false, reason: "key_disabled" });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("203.0.113.20", "sk-disabled");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);

    const error = await readErrorBody(response as Response);
    expect(error.type).toBe("key_disabled");
    expect(error.code).toBe("key_disabled");
    expect(error.message).toMatch(/已被禁用/);

    expect(policyRecordFailure).not.toHaveBeenCalled();
    expect(policyRecordSuccess).not.toHaveBeenCalled();
  });

  it("expired key returns 401 key_expired and does NOT count toward rate limit", async () => {
    resolveApiKeyAuthOutcome.mockResolvedValue({ ok: false, reason: "key_expired" });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("203.0.113.21", "sk-expired");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response?.status).toBe(401);

    const error = await readErrorBody(response as Response);
    expect(error.type).toBe("key_expired");
    expect(error.code).toBe("key_expired");
    expect(error.message).toMatch(/已过期/);

    expect(policyRecordFailure).not.toHaveBeenCalled();
  });

  it("disabled user returns 401 user_disabled and does NOT count toward rate limit", async () => {
    resolveApiKeyAuthOutcome.mockResolvedValue({
      ok: true,
      user: { id: 7, name: "bob", isEnabled: false, expiresAt: null },
      key: { name: "bobs-key" },
    });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("203.0.113.22", "sk-userdisabled");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response?.status).toBe(401);

    const error = await readErrorBody(response as Response);
    expect(error.type).toBe("user_disabled");
    expect(error.message).toMatch(/账户已被禁用/);

    expect(policyRecordFailure).not.toHaveBeenCalled();
  });

  it("expired user returns 401 user_expired, marks the user expired, and does NOT count toward rate limit", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    resolveApiKeyAuthOutcome.mockResolvedValue({
      ok: true,
      user: { id: 8, name: "carol", isEnabled: true, expiresAt: yesterday },
      key: { name: "carols-key" },
    });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("203.0.113.23", "sk-userexpired");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response?.status).toBe(401);

    const error = await readErrorBody(response as Response);
    expect(error.type).toBe("user_expired");
    expect(error.message).toMatch(/已于.*过期/);

    expect(markUserExpired).toHaveBeenCalledWith(8);
    expect(policyRecordFailure).not.toHaveBeenCalled();
  });

  it("unknown key still records failure (genuine brute-force signal)", async () => {
    resolveApiKeyAuthOutcome.mockResolvedValue({ ok: false, reason: "not_found" });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("203.0.113.24", "sk-doesnotexist");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response?.status).toBe(401);

    const error = await readErrorBody(response as Response);
    expect(error.type).toBe("invalid_api_key");
    expect(error.message).toMatch(/不存在|已被删除/);

    expect(policyRecordFailure).toHaveBeenCalledWith("203.0.113.24", "sk-doesnotexist");
  });

  it("missing credentials returns 401 authentication_error and records failure", async () => {
    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = {
      headers: new Headers({ "x-real-ip": "203.0.113.25" }),
      requestUrl: new URL("http://localhost/v1/messages"),
      clientIp: null as string | null,
      authState: null as unknown,
      setAuthState(state: unknown) {
        this.authState = state;
      },
    };
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response?.status).toBe(401);

    const error = await readErrorBody(response as Response);
    expect(error.type).toBe("authentication_error");

    expect(resolveApiKeyAuthOutcome).not.toHaveBeenCalled();
    expect(policyRecordFailure).toHaveBeenCalledWith("203.0.113.25", undefined);
  });

  it("repeated disabled-key attempts never trip the 429 lockout", async () => {
    // Simulate the bug scenario: the same disabled key is hit 25 times in a
    // row. Before the fix, the 20th attempt would trip the rate limiter and
    // start returning 429s. After the fix, every attempt should return 401
    // key_disabled and the rate-limiter counter must remain untouched.
    resolveApiKeyAuthOutcome.mockResolvedValue({ ok: false, reason: "key_disabled" });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");

    for (let attempt = 0; attempt < 25; attempt++) {
      const session = makeSession("203.0.113.30", "sk-perma-disabled");
      const response = await ProxyAuthenticator.ensure(session as never);
      expect(response?.status).toBe(401);
      const error = await readErrorBody(response as Response);
      expect(error.type).toBe("key_disabled");
    }

    expect(policyRecordFailure).not.toHaveBeenCalled();
  });
});
