import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { extractApiCredentialFromHeaders } from "@/lib/api/auth-header-extractor";
import type { AuthCredentialType, AuthSession } from "@/lib/auth";
import { isApiKeyAdminAccessEnabled } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { CSRF_HEADER } from "./constants";
import { isMutationMethod, verifyCsrfToken } from "./csrf";
import { createProblemResponse } from "./error-envelope";

export type AuthTier = "public" | "read" | "admin";

export type ResolvedAuth = {
  session: AuthSession | null;
  token: string | null;
  source: "bearer" | "api-key" | "cookie" | "none";
  credentialType: AuthCredentialType;
  allowReadOnlyAccess: boolean;
};

export async function extractManagementAuthToken(
  c: Context
): Promise<Pick<ResolvedAuth, "token" | "source">> {
  const credential = extractApiCredentialFromHeaders({
    authorization: c.req.header("authorization") ?? null,
    "x-api-key": c.req.header("x-api-key") ?? null,
    "x-goog-api-key": null,
  });
  if (credential.token) {
    return {
      token: credential.token,
      source: credential.source === "bearer" ? "bearer" : "api-key",
    };
  }

  const { AUTH_COOKIE_NAME } = await import("@/lib/auth");
  const cookieToken =
    getCookie(c, AUTH_COOKIE_NAME) ||
    getAuthCookieFromHeader(
      AUTH_COOKIE_NAME,
      c.req.header("cookie") ??
        c.req.header("Cookie") ??
        c.req.raw?.headers.get("cookie") ??
        c.req.raw?.headers.get("Cookie")
    );
  return cookieToken ? { token: cookieToken, source: "cookie" } : { token: null, source: "none" };
}

function getAuthCookieFromHeader(
  cookieName: string,
  raw: string | null | undefined
): string | undefined {
  const cookiePairs = raw?.split(";") ?? [];
  for (const pair of cookiePairs) {
    const [name, ...valueParts] = pair.trim().split("=");
    if (name !== cookieName) continue;
    const value = valueParts.join("=").trim();
    if (!value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function resolveAuth(c: Context, tier: AuthTier): Promise<ResolvedAuth | Response> {
  if (tier === "public") {
    return {
      session: null,
      token: null,
      source: "none",
      credentialType: "none",
      allowReadOnlyAccess: true,
    };
  }

  const extracted = await extractManagementAuthToken(c);
  if (!extracted.token) {
    return createProblemResponse({
      status: 401,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.missing",
      detail: "Authentication is required.",
    });
  }

  const allowReadOnlyAccess = tier === "read";
  const [{ validateAuthToken }, credentialType] = await Promise.all([
    import("@/lib/auth"),
    classifyCredential(extracted.token, extracted.source),
  ]);
  const session = await validateAuthToken(extracted.token, { allowReadOnlyAccess });
  if (!session) {
    return createProblemResponse({
      status: 401,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.invalid",
      detail: "Authentication is invalid or expired.",
    });
  }
  if (tier === "admin" && session.user.role !== "admin") {
    return createProblemResponse({
      status: 403,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.forbidden",
      detail: "Admin access is required.",
    });
  }

  if (tier === "admin" && credentialType === "user-api-key" && !isApiKeyAdminAccessEnabled()) {
    return createProblemResponse({
      status: 403,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.api_key_admin_disabled",
      detail: "API key admin access is disabled.",
    });
  }

  if (
    extracted.source === "cookie" &&
    isMutationMethod(c.req.method) &&
    !verifyCsrfToken({
      token: c.req.header(CSRF_HEADER),
      authToken: extracted.token,
      userId: session.user.id,
    })
  ) {
    return createProblemResponse({
      status: 403,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.csrf_invalid",
      detail: "CSRF token is missing or invalid.",
    });
  }

  return {
    session,
    token: extracted.token,
    source: extracted.source,
    credentialType,
    allowReadOnlyAccess,
  };
}

async function classifyCredential(
  token: string,
  source: ResolvedAuth["source"]
): Promise<ResolvedAuth["credentialType"]> {
  if (source === "none") return "none";

  const [{ detectSessionTokenKind }, { config }, { constantTimeEqual }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/config/config"),
    import("@/lib/security/constant-time-compare"),
  ]);

  const adminToken = config.auth.adminToken;
  if (adminToken && constantTimeEqual(token, adminToken)) return "admin-token";
  if (detectSessionTokenKind(token) === "opaque") {
    return classifyOpaqueSessionCredential(token);
  }
  return source === "cookie" ? "session" : "user-api-key";
}

async function classifyOpaqueSessionCredential(
  token: string
): Promise<ResolvedAuth["credentialType"]> {
  try {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");
    const sessionData = await new RedisSessionStore().read(token);
    return sessionData?.credentialType ?? "user-api-key";
  } catch (error) {
    logger.warn("[V1Auth] Failed to classify opaque session credential", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "user-api-key";
  }
}

export function requireAuth(tier: AuthTier): MiddlewareHandler {
  return async (c, next) => {
    const resolved = await resolveAuth(c, tier);
    if (resolved instanceof Response) return resolved;

    c.set("auth", resolved);
    const [{ runWithRequestContext }, { runWithAuthSession }, { getClientIp }] = await Promise.all([
      import("@/lib/audit/request-context"),
      import("@/lib/auth"),
      import("@/lib/ip"),
    ]);
    const requestContext = {
      ip: getClientIp(c.req.raw.headers),
      userAgent: c.req.header("user-agent") ?? null,
    };

    if (!resolved.session) {
      return runWithRequestContext(requestContext, next);
    }

    return runWithAuthSession(resolved.session, () => runWithRequestContext(requestContext, next), {
      allowReadOnlyAccess: resolved.allowReadOnlyAccess,
    });
  };
}
