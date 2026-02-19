import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { applyCors } from "../../src/app/v1/_lib/cors";

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
  withNoStoreHeaders: <T>(response: T): T => {
    (response as Response).headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    (response as Response).headers.set("Pragma", "no-cache");
    return response;
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

type LoginPostHandler = (request: NextRequest) => Promise<Response>;
type LogoutPostHandler = (request: NextRequest) => Promise<Response>;

function makeLoginRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeLogoutRequest(): NextRequest {
  return new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
  });
}

function expectSharedSecurityHeaders(response: Response) {
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("X-DNS-Prefetch-Control")).toBe("off");
}

const fakeSession = {
  user: {
    id: 1,
    name: "Test User",
    description: "desc",
    role: "user" as const,
  },
  key: {
    canLoginWebUi: true,
  },
};

describe("security headers auth route integration", () => {
  let loginPost: LoginPostHandler;
  let logoutPost: LogoutPostHandler;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const t = vi.fn((messageKey: string) => `translated:${messageKey}`);
    mockGetTranslations.mockResolvedValue(t);
    mockValidateKey.mockResolvedValue(fakeSession);
    mockSetAuthCookie.mockResolvedValue(undefined);
    mockGetSessionTokenMode.mockReturnValue("legacy");
    mockGetLoginRedirectTarget.mockReturnValue("/dashboard");
    mockClearAuthCookie.mockResolvedValue(undefined);
    mockGetAuthCookie.mockResolvedValue(undefined);
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });

    const loginRoute = await import("../../src/app/api/auth/login/route");
    loginPost = loginRoute.POST;

    const logoutRoute = await import("../../src/app/api/auth/logout/route");
    logoutPost = logoutRoute.POST;
  });

  it("login success response includes security headers", async () => {
    const res = await loginPost(makeLoginRequest({ key: "valid-key" }));

    expect(res.status).toBe(200);
    expectSharedSecurityHeaders(res);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("login error response includes security headers", async () => {
    const res = await loginPost(makeLoginRequest({}));

    expect(res.status).toBe(400);
    expectSharedSecurityHeaders(res);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("logout response includes security headers", async () => {
    const res = await logoutPost(makeLogoutRequest());

    expect(res.status).toBe(200);
    expectSharedSecurityHeaders(res);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("CSP is applied in report-only mode by default", async () => {
    const res = await loginPost(makeLoginRequest({ key: "valid-key" }));

    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("HSTS is present when ENABLE_SECURE_COOKIES=true", async () => {
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });

    const res = await loginPost(makeLoginRequest({ key: "valid-key" }));

    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains"
    );
  });

  it("HSTS is absent when ENABLE_SECURE_COOKIES=false", async () => {
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });

    const res = await logoutPost(makeLogoutRequest());

    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("X-Content-Type-Options is always nosniff", async () => {
    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
    const secureRes = await loginPost(makeLoginRequest({ key: "valid-key" }));

    mockGetEnvConfig.mockReturnValue({ ENABLE_SECURE_COOKIES: false });
    const errorRes = await loginPost(makeLoginRequest({}));
    const logoutRes = await logoutPost(makeLogoutRequest());

    expect(secureRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(errorRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(logoutRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("security headers remain compatible with existing CORS headers", async () => {
    const res = await loginPost(makeLoginRequest({ key: "valid-key" }));
    const corsRes = applyCors(res, {
      origin: "https://client.example.com",
      requestHeaders: "content-type,x-api-key",
    });

    // Without allowCredentials, origin is NOT reflected — stays as wildcard
    expect(corsRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(corsRes.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(corsRes.headers.get("Access-Control-Allow-Headers")).toBe("content-type,x-api-key");
    expect(corsRes.headers.get("Content-Security-Policy-Report-Only")).toContain(
      "default-src 'self'"
    );
    expect(corsRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("CORS reflects origin only when allowCredentials is explicitly set", async () => {
    const res = await loginPost(makeLoginRequest({ key: "valid-key" }));
    const corsRes = applyCors(res, {
      origin: "https://trusted.example.com",
      requestHeaders: "content-type",
      allowCredentials: true,
    });

    expect(corsRes.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.example.com");
    expect(corsRes.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});
