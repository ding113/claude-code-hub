import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";

const validateApiKeyAndGetUser = vi.fn();
const markUserExpired = vi.fn();
const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createSession(params?: {
  ip?: string;
  authorization?: string;
  apiKeyHeader?: string;
  geminiApiKeyHeader?: string;
  geminiApiKeyQuery?: string;
}) {
  const headers = new Headers();
  const ip = params?.ip ?? "198.51.100.10";
  headers.set("x-real-ip", ip);

  if (params?.authorization) {
    headers.set("authorization", params.authorization);
  }

  if (params?.apiKeyHeader) {
    headers.set("x-api-key", params.apiKeyHeader);
  }

  if (params?.geminiApiKeyHeader) {
    headers.set("x-goog-api-key", params.geminiApiKeyHeader);
  }

  const requestUrl = new URL("https://example.com/v1/messages");
  if (params?.geminiApiKeyQuery) {
    requestUrl.searchParams.set("key", params.geminiApiKeyQuery);
  }

  return {
    headers,
    requestUrl,
    setAuthState: vi.fn(),
  } as unknown as ProxySession & { setAuthState: ReturnType<typeof vi.fn> };
}

async function importSubject() {
  vi.resetModules();
  vi.doMock("@/repository/key", () => ({
    validateApiKeyAndGetUser,
  }));
  vi.doMock("@/repository/user", () => ({
    markUserExpired,
  }));
  vi.doMock("@/lib/logger", () => ({
    logger,
  }));

  return import("@/app/v1/_lib/proxy/auth-guard");
}

describe("ProxyAuthenticator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T09:40:00.000+08:00"));
    validateApiKeyAndGetUser.mockReset();
    markUserExpired.mockReset();
    logger.debug.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("allows a valid key even after the same IP accumulated failed attempts", async () => {
    validateApiKeyAndGetUser.mockImplementation(async (apiKey: string) => {
      if (apiKey === "sk-valid") {
        return {
          user: {
            id: 1,
            name: "Valid User",
            isEnabled: true,
            expiresAt: null,
          },
          key: {
            name: "valid-key",
          },
        };
      }

      return null;
    });

    const { ProxyAuthenticator } = await importSubject();
    const clientIp = "203.0.113.9";

    for (let i = 0; i < 20; i++) {
      const response = await ProxyAuthenticator.ensure(
        createSession({
          ip: clientIp,
          authorization: `Bearer sk-bad-${i}`,
        })
      );

      expect(response).not.toBeNull();
      expect(response?.status).toBe(i === 19 ? 429 : 401);
    }

    const validSession = createSession({
      ip: clientIp,
      authorization: "Bearer sk-valid",
    });
    const response = await ProxyAuthenticator.ensure(validSession);

    expect(response).toBeNull();
    expect(validSession.setAuthState).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        apiKey: "sk-valid",
      })
    );
  });

  it("returns 429 with Retry-After after repeated invalid key failures", async () => {
    validateApiKeyAndGetUser.mockResolvedValue(null);

    const { ProxyAuthenticator } = await importSubject();

    for (let i = 0; i < 19; i++) {
      const response = await ProxyAuthenticator.ensure(
        createSession({
          ip: "203.0.113.10",
          authorization: `Bearer sk-invalid-${i}`,
        })
      );

      expect(response?.status).toBe(401);
    }

    const response = await ProxyAuthenticator.ensure(
      createSession({
        ip: "203.0.113.10",
        authorization: "Bearer sk-invalid-final",
      })
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("600");
    await expect(response?.json()).resolves.toEqual({
      error: {
        message: "Too many authentication failures. Please retry later.",
        type: "rate_limit_error",
        code: "rate_limit_error",
      },
    });
  });
});
