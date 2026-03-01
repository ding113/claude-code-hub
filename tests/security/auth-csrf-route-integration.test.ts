import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockValidateKey = vi.hoisted(() => vi.fn());
const mockSetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetSessionTokenMode = vi.hoisted(() => vi.fn());
const mockGetLoginRedirectTarget = vi.hoisted(() => vi.fn());
const mockClearAuthCookie = vi.hoisted(() => vi.fn());
const mockGetAuthCookie = vi.hoisted(() => vi.fn());
const mockGetTranslations = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  validateKey: mockValidateKey,
  setAuthCookie: mockSetAuthCookie,
  getSessionTokenMode: mockGetSessionTokenMode,
  getLoginRedirectTarget: mockGetLoginRedirectTarget,
  clearAuthCookie: mockClearAuthCookie,
  getAuthCookie: mockGetAuthCookie,
  toKeyFingerprint: vi.fn().mockResolvedValue("sha256:mock"),
  withNoStoreHeaders: <T>(res: T): T => {
    (res as any).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as any).headers.set("Pragma", "no-cache");
    return res;
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mockGetTranslations,
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

vi.mock("@/lib/security/auth-response-headers", () => ({
  withAuthResponseHeaders: <T>(res: T): T => {
    (res as any).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (res as any).headers.set("Pragma", "no-cache");
    return res;
  },
}));

type LoginPostHandler = (request: NextRequest) => Promise<Response>;
type LogoutPostHandler = (request: NextRequest) => Promise<Response>;

function makeLoginRequest(headers: Record<string, string> = {}, key = "valid-key"): NextRequest {
  const requestHeaders = new Headers({
    "content-type": "application/json",
    ...headers,
  });

  return {
    headers: requestHeaders,
    cookies: {
      get: () => undefined,
    },
    json: async () => ({ key }),
  } as unknown as NextRequest;
}

function makeLogoutRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

describe("auth route csrf guard integration", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let loginPost: LoginPostHandler;
  let logoutPost: LogoutPostHandler;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";

    mockGetTranslations.mockResolvedValue(
      vi.fn((messageKey: string) => `translated:${messageKey}`)
    );
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });
    mockValidateKey.mockResolvedValue({
      user: {
        id: 1,
        name: "Test User",
        description: "desc",
        role: "user",
      },
      key: {
        canLoginWebUi: true,
      },
    });
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");
    mockClearAuthCookie.mockResolvedValue(undefined);
    mockGetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");

    const loginRoute = await import("@/app/api/auth/login/route");
    loginPost = loginRoute.POST;

    const logoutRoute = await import("@/app/api/auth/logout/route");
    logoutPost = logoutRoute.POST;
  });

  it("allows same-origin login request to pass through", async () => {
    const res = await loginPost(makeLoginRequest({ "sec-fetch-site": "same-origin" }));

    expect(res.status).toBe(200);
    expect(mockValidateKey).toHaveBeenCalledWith("valid-key", { allowReadOnlyAccess: true });
  });

  it("blocks cross-origin login request with csrf rejected error", async () => {
    const request = makeLoginRequest({
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.com",
    });

    const res = await loginPost(request);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ errorCode: "CSRF_REJECTED" });
    expect(mockValidateKey).not.toHaveBeenCalled();
  });

  it("allows login request without origin header for non-browser clients", async () => {
    const res = await loginPost(makeLoginRequest());

    expect(res.status).toBe(200);
    expect(mockValidateKey).toHaveBeenCalledTimes(1);
  });

  it("allows same-origin logout request to pass through", async () => {
    const res = await logoutPost(makeLogoutRequest({ "sec-fetch-site": "same-origin" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockClearAuthCookie).toHaveBeenCalledTimes(1);
  });

  it("blocks cross-origin logout request with csrf rejected error", async () => {
    const request = makeLogoutRequest({
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example.com",
    });

    const res = await logoutPost(request);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ errorCode: "CSRF_REJECTED" });
    expect(mockClearAuthCookie).not.toHaveBeenCalled();
  });

  it("allows logout request without origin header for non-browser clients", async () => {
    const res = await logoutPost(makeLogoutRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockClearAuthCookie).toHaveBeenCalledTimes(1);
  });
});
