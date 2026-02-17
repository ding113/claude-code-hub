import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockValidateKey = vi.hoisted(() => vi.fn());
const mockSetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetLoginRedirectTarget = vi.hoisted(() => vi.fn());
const mockGetSessionTokenMode = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  validateKey: mockValidateKey,
  setAuthCookie: mockSetAuthCookie,
  getLoginRedirectTarget: mockGetLoginRedirectTarget,
  getSessionTokenMode: mockGetSessionTokenMode,
  withNoStoreHeaders: <T>(res: T): T => {
    (res as Response).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as Response).headers.set("Pragma", "no-cache");
    return res;
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mockGetTranslations,
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

function makeRequest(body: unknown, ip: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify(body),
  });
}

const fakeSession = {
  user: {
    id: 1,
    name: "Test User",
    description: "desc",
    role: "user" as const,
  },
  key: { canLoginWebUi: true },
};

async function exhaustFailures(
  POST: (request: NextRequest) => Promise<Response>,
  ip: string,
  count = 10
) {
  for (let i = 0; i < count; i++) {
    const res = await POST(makeRequest({ key: `bad-${i}` }, ip));
    expect(res.status).toBe(401);
  }
}

describe("auth login anti-bruteforce integration", () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const mockT = vi.fn((key: string) => `translated:${key}`);
    mockGetTranslations.mockResolvedValue(mockT);
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");
    mockGetSessionTokenMode.mockReturnValue("legacy");

    const mod = await import("../../src/app/api/auth/login/route");
    POST = mod.POST;
  });

  it("normal request passes rate-limit check", async () => {
    mockValidateKey.mockResolvedValue(null);

    const res = await POST(makeRequest({ key: "bad-key" }, "198.51.100.10"));

    expect(res.status).toBe(401);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(mockValidateKey).toHaveBeenCalledWith("bad-key", { allowReadOnlyAccess: true });
  });

  it("returns 429 with Retry-After after max failures", async () => {
    const ip = "198.51.100.20";
    mockValidateKey.mockResolvedValue(null);

    await exhaustFailures(POST, ip);

    const blockedRes = await POST(makeRequest({ key: "blocked-now" }, ip));

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("Retry-After")).not.toBeNull();
    expect(Number.parseInt(blockedRes.headers.get("Retry-After") ?? "0", 10)).toBeGreaterThan(0);
    expect(mockValidateKey).toHaveBeenCalledTimes(10);
  });

  it("successful login resets failure counter", async () => {
    const ip = "198.51.100.30";
    mockValidateKey.mockImplementation(async (key: string) => {
      return key === "valid-key" ? fakeSession : null;
    });

    for (let i = 0; i < 9; i++) {
      const res = await POST(makeRequest({ key: `bad-before-success-${i}` }, ip));
      expect(res.status).toBe(401);
    }

    const successRes = await POST(makeRequest({ key: "valid-key" }, ip));
    expect(successRes.status).toBe(200);

    const firstAfterSuccess = await POST(makeRequest({ key: "bad-after-success-1" }, ip));
    const secondAfterSuccess = await POST(makeRequest({ key: "bad-after-success-2" }, ip));

    expect(firstAfterSuccess.status).toBe(401);
    expect(secondAfterSuccess.status).toBe(401);
    expect(secondAfterSuccess.headers.get("Retry-After")).toBeNull();
    expect(mockSetAuthCookie).toHaveBeenCalledWith("valid-key");
  });

  it("429 response includes errorCode RATE_LIMITED", async () => {
    const ip = "198.51.100.40";
    mockValidateKey.mockResolvedValue(null);

    await exhaustFailures(POST, ip);

    const blockedRes = await POST(makeRequest({ key: "blocked-key" }, ip));

    expect(blockedRes.status).toBe(429);
    await expect(blockedRes.json()).resolves.toMatchObject({
      errorCode: "RATE_LIMITED",
    });
  });

  it("tracks different IPs independently", async () => {
    const blockedIp = "198.51.100.50";
    const freshIp = "198.51.100.51";
    mockValidateKey.mockResolvedValue(null);

    await exhaustFailures(POST, blockedIp);

    const blockedRes = await POST(makeRequest({ key: "blocked-key" }, blockedIp));
    const freshRes = await POST(makeRequest({ key: "fresh-ip-key" }, freshIp));

    expect(blockedRes.status).toBe(429);
    expect(freshRes.status).toBe(401);
  });
});
