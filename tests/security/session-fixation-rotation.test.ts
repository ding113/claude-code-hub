import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

const {
  mockClearAuthCookie,
  mockGetAuthCookie,
  mockGetSessionTokenMode,
  mockRevoke,
  mockRotate,
  mockRedisSessionStoreCtor,
  mockLogger,
} = vi.hoisted(() => {
  const mockRevoke = vi.fn();
  const mockRotate = vi.fn();

  return {
    mockClearAuthCookie: vi.fn(),
    mockGetAuthCookie: vi.fn(),
    mockGetSessionTokenMode: vi.fn(),
    mockRevoke,
    mockRotate,
    mockRedisSessionStoreCtor: vi.fn().mockImplementation(function RedisSessionStoreMock() {
      return {
        revoke: mockRevoke,
        rotate: mockRotate,
      };
    }),
    mockLogger: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    },
  };
});

const realWithNoStoreHeaders = vi.hoisted(() => {
  return <T extends InstanceType<typeof NextResponse>>(response: T): T => {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    return response;
  };
});

vi.mock("@/lib/auth", () => ({
  clearAuthCookie: mockClearAuthCookie,
  getAuthCookie: mockGetAuthCookie,
  getSessionTokenMode: mockGetSessionTokenMode,
  withNoStoreHeaders: realWithNoStoreHeaders,
}));

vi.mock("@/lib/auth-session-store/redis-session-store", () => ({
  RedisSessionStore: mockRedisSessionStoreCtor,
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: vi.fn().mockReturnValue({ ENABLE_SECURE_COOKIES: false }),
}));

vi.mock("@/lib/security/auth-response-headers", () => ({
  withAuthResponseHeaders: realWithNoStoreHeaders,
}));

function makeLogoutRequest(): NextRequest {
  return new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
    },
  });
}

async function loadLogoutPost(): Promise<(request: NextRequest) => Promise<Response>> {
  const mod = await import("@/app/api/auth/logout/route");
  return mod.POST;
}

async function simulatePostLoginSessionRotation(
  oldSessionId: string,
  rotate: (sessionId: string) => Promise<{ sessionId: string } | null>
): Promise<string | null> {
  const rotated = await rotate(oldSessionId);
  return rotated?.sessionId ?? null;
}

describe("session fixation rotation and logout revocation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRedisSessionStoreCtor.mockImplementation(function RedisSessionStoreMock() {
      return {
        revoke: mockRevoke,
        rotate: mockRotate,
      };
    });
    mockClearAuthCookie.mockResolvedValue(undefined);
    mockGetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");
    mockRevoke.mockResolvedValue(true);
    mockRotate.mockResolvedValue(null);
  });

  it("legacy mode logout only clears cookie without session store revocation", async () => {
    mockGetSessionTokenMode.mockReturnValue("legacy");
    const POST = await loadLogoutPost();

    const response = await POST(makeLogoutRequest());

    expect(response.status).toBe(200);
    expect(mockRedisSessionStoreCtor).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockClearAuthCookie).toHaveBeenCalledTimes(1);
  });

  it("dual mode logout revokes session and clears cookie", async () => {
    mockGetSessionTokenMode.mockReturnValue("dual");
    mockGetAuthCookie.mockResolvedValue("sid_dual_session");
    const POST = await loadLogoutPost();

    const response = await POST(makeLogoutRequest());

    expect(response.status).toBe(200);
    expect(mockRedisSessionStoreCtor).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith("sid_dual_session");
    expect(mockClearAuthCookie).toHaveBeenCalledTimes(1);
  });

  it("opaque mode logout revokes session and clears cookie", async () => {
    mockGetSessionTokenMode.mockReturnValue("opaque");
    mockGetAuthCookie.mockResolvedValue("sid_opaque_session");
    const POST = await loadLogoutPost();

    const response = await POST(makeLogoutRequest());

    expect(response.status).toBe(200);
    expect(mockRedisSessionStoreCtor).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith("sid_opaque_session");
    expect(mockClearAuthCookie).toHaveBeenCalledTimes(1);
  });

  it("logout still clears cookie when session revocation fails", async () => {
    mockGetSessionTokenMode.mockReturnValue("opaque");
    mockGetAuthCookie.mockResolvedValue("sid_revocation_failure");
    mockRevoke.mockRejectedValue(new Error("redis down"));
    const POST = await loadLogoutPost();

    const response = await POST(makeLogoutRequest());

    expect(response.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith("sid_revocation_failure");
    expect(mockClearAuthCookie).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it("post-login rotation returns a different session id", async () => {
    const oldSessionId = "sid_existing_session";
    mockRotate.mockResolvedValue({
      sessionId: "sid_rotated_session",
      keyFingerprint: "fp-login",
      userId: 7,
      userRole: "user",
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_300_000,
    });

    const rotatedSessionId = await simulatePostLoginSessionRotation(oldSessionId, mockRotate);

    expect(mockRotate).toHaveBeenCalledWith(oldSessionId);
    expect(rotatedSessionId).toBe("sid_rotated_session");
    expect(rotatedSessionId).not.toBe(oldSessionId);
  });
});
