import { beforeEach, describe, expect, it, vi } from "vitest";

const validateApiKeyAndGetUser = vi.hoisted(() => vi.fn());
const policyCheck = vi.hoisted(() => vi.fn());
const policyRecordSuccess = vi.hoisted(() => vi.fn());
const policyRecordFailure = vi.hoisted(() => vi.fn());

vi.mock("@/repository/key", () => ({
  validateApiKeyAndGetUser,
}));

vi.mock("@/repository/user", () => ({
  markUserExpired: vi.fn().mockResolvedValue(undefined),
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
    requestUrl: new URL("http://localhost/v1/models"),
    clientIp: null as string | null,
    authState: null as unknown,
    setAuthState(state: unknown) {
      this.authState = state;
    },
  };
}

describe("ProxyAuthenticator pre-auth candidate key lockout", () => {
  beforeEach(() => {
    vi.resetModules();
    validateApiKeyAndGetUser.mockReset();
    policyCheck.mockReset();
    policyRecordSuccess.mockReset();
    policyRecordFailure.mockReset();
  });

  it("blocks a locked API key before validation and passes candidate key into the check", async () => {
    policyCheck.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 42,
      reason: "key_rate_limited",
    });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("198.51.100.77", "sk-shared");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response?.status).toBe(429);
    expect(validateApiKeyAndGetUser).not.toHaveBeenCalled();
    expect(policyCheck).toHaveBeenCalledWith("198.51.100.77", "sk-shared");
    expect(session.clientIp).toBe("198.51.100.77");
  });

  it("resets both IP and key scopes on successful authentication", async () => {
    policyCheck.mockReturnValue({ allowed: true });
    validateApiKeyAndGetUser.mockResolvedValue({
      user: { id: 1, name: "alice", isEnabled: true, expiresAt: null },
      key: { name: "primary-key" },
    });

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("203.0.113.10", "sk-success");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response).toBeNull();
    expect(policyRecordSuccess).toHaveBeenCalledWith("203.0.113.10", "sk-success");
    expect(policyRecordFailure).not.toHaveBeenCalled();
  });

  it("records failures against both IP and candidate key", async () => {
    policyCheck.mockReturnValue({ allowed: true });
    validateApiKeyAndGetUser.mockResolvedValue(null);

    const { ProxyAuthenticator } = await import("@/app/v1/_lib/proxy/auth-guard");
    const session = makeSession("203.0.113.11", "sk-invalid");
    const response = await ProxyAuthenticator.ensure(session as never);

    expect(response?.status).toBe(401);
    expect(policyRecordFailure).toHaveBeenCalledWith("203.0.113.11", "sk-invalid");
    expect(policyRecordSuccess).not.toHaveBeenCalled();
  });
});
