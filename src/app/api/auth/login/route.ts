import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { defaultLocale, type Locale, locales } from "@/i18n/config";
import {
  type AuthSession,
  getLoginRedirectTarget,
  getSessionTokenMode,
  setAuthCookie,
  toKeyFingerprint,
  validateKey,
} from "@/lib/auth";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { withAuthResponseHeaders } from "@/lib/security/auth-response-headers";
import { createCsrfOriginGuard } from "@/lib/security/csrf-origin-guard";
import { LoginAbusePolicy } from "@/lib/security/login-abuse-policy";

// 需要数据库连接
export const runtime = "nodejs";

const csrfGuard = createCsrfOriginGuard({
  allowedOrigins: [],
  allowSameOrigin: true,
  enforceInDevelopment: process.env.VITEST === "true",
});

const loginPolicy = new LoginAbusePolicy();

/**
 * Get locale from request (cookie or Accept-Language header)
 */
function getLocaleFromRequest(request: NextRequest): Locale {
  // 1. Check NEXT_LOCALE cookie
  const localeCookie = request.cookies.get("NEXT_LOCALE")?.value;
  if (localeCookie && locales.includes(localeCookie as Locale)) {
    return localeCookie as Locale;
  }

  // 2. Check Accept-Language header
  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) {
    for (const locale of locales) {
      if (acceptLanguage.toLowerCase().includes(locale.toLowerCase())) {
        return locale;
      }
    }
  }

  // 3. Fall back to default
  return defaultLocale;
}

async function getAuthErrorTranslations(locale: Locale) {
  try {
    return await getTranslations({ locale, namespace: "auth.errors" });
  } catch (error) {
    logger.warn("Login route: failed to load auth.errors translations", {
      locale,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      return await getTranslations({ locale: defaultLocale, namespace: "auth.errors" });
    } catch (fallbackError) {
      logger.error("Login route: failed to load default auth.errors translations", {
        locale: defaultLocale,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      return null;
    }
  }
}

async function getAuthSecurityTranslations(locale: Locale) {
  try {
    return await getTranslations({ locale, namespace: "auth.security" });
  } catch (error) {
    logger.warn("Login route: failed to load auth.security translations", {
      locale,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      return await getTranslations({ locale: defaultLocale, namespace: "auth.security" });
    } catch (fallbackError) {
      logger.error("Login route: failed to load default auth.security translations", {
        locale: defaultLocale,
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      return null;
    }
  }
}

function hasSecureCookieHttpMismatch(request: NextRequest): boolean {
  const env = getEnvConfig();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return env.ENABLE_SECURE_COOKIES && forwardedProto === "http";
}

function shouldIncludeFailureTaxonomy(request: NextRequest): boolean {
  return request.headers.has("x-forwarded-proto");
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

let sessionStoreInstance:
  | import("@/lib/auth-session-store/redis-session-store").RedisSessionStore
  | null = null;

async function getLoginSessionStore() {
  if (!sessionStoreInstance) {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");
    sessionStoreInstance = new RedisSessionStore();
  }
  return sessionStoreInstance;
}

async function createOpaqueSession(key: string, session: AuthSession) {
  const store = await getLoginSessionStore();
  return store.create({
    keyFingerprint: await toKeyFingerprint(key),
    userId: session.user.id,
    userRole: session.user.role,
  });
}

export async function POST(request: NextRequest) {
  const csrfResult = csrfGuard.check(request);
  if (!csrfResult.allowed) {
    return withAuthResponseHeaders(
      NextResponse.json({ errorCode: "CSRF_REJECTED" }, { status: 403 })
    );
  }

  const locale = getLocaleFromRequest(request);
  const t = await getAuthErrorTranslations(locale);
  const clientIp = getClientIp(request);

  const decision = loginPolicy.check(clientIp);
  if (!decision.allowed) {
    const response = withAuthResponseHeaders(
      NextResponse.json(
        {
          error: t?.("loginFailed") ?? t?.("serverError") ?? "Too many attempts",
          errorCode: "RATE_LIMITED",
        },
        { status: 429 }
      )
    );

    if (decision.retryAfterSeconds != null) {
      response.headers.set("Retry-After", String(decision.retryAfterSeconds));
    }

    return response;
  }

  try {
    const { key } = await request.json();

    if (!key) {
      if (!shouldIncludeFailureTaxonomy(request)) {
        return withAuthResponseHeaders(
          NextResponse.json(
            { error: t?.("apiKeyRequired") ?? "API key is required" },
            { status: 400 }
          )
        );
      }

      return withAuthResponseHeaders(
        NextResponse.json(
          { error: t?.("apiKeyRequired") ?? "API key is required", errorCode: "KEY_REQUIRED" },
          { status: 400 }
        )
      );
    }

    const session = await validateKey(key, { allowReadOnlyAccess: true });
    if (!session) {
      loginPolicy.recordFailure(clientIp);

      if (!shouldIncludeFailureTaxonomy(request)) {
        return withAuthResponseHeaders(
          NextResponse.json(
            { error: t?.("apiKeyInvalidOrExpired") ?? "Authentication failed" },
            { status: 401 }
          )
        );
      }

      const responseBody: {
        error: string;
        errorCode: "KEY_INVALID";
        httpMismatchGuidance?: string;
      } = {
        error: t?.("apiKeyInvalidOrExpired") ?? "Authentication failed",
        errorCode: "KEY_INVALID",
      };

      if (hasSecureCookieHttpMismatch(request)) {
        const securityT = await getAuthSecurityTranslations(locale);
        responseBody.httpMismatchGuidance =
          securityT?.("cookieWarningDescription") ??
          t?.("apiKeyInvalidOrExpired") ??
          t?.("serverError");
      }

      return withAuthResponseHeaders(NextResponse.json(responseBody, { status: 401 }));
    }

    const mode = getSessionTokenMode();
    if (mode === "legacy") {
      await setAuthCookie(key);
    } else if (mode === "dual") {
      await setAuthCookie(key);
      try {
        await createOpaqueSession(key, session);
      } catch (error) {
        logger.warn("Failed to create opaque session in dual mode", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      try {
        const opaqueSession = await createOpaqueSession(key, session);
        await setAuthCookie(opaqueSession.sessionId);
      } catch (error) {
        logger.error("Failed to create opaque session, falling back to legacy cookie", {
          error: error instanceof Error ? error.message : String(error),
        });
        await setAuthCookie(key);
      }
    }

    loginPolicy.recordSuccess(clientIp);

    const redirectTo = getLoginRedirectTarget(session);
    const loginType =
      session.user.role === "admin"
        ? "admin"
        : session.key.canLoginWebUi
          ? "dashboard_user"
          : "readonly_user";

    return withAuthResponseHeaders(
      NextResponse.json({
        ok: true,
        user: {
          id: session.user.id,
          name: session.user.name,
          description: session.user.description,
          role: session.user.role,
        },
        redirectTo,
        loginType,
      })
    );
  } catch (error) {
    logger.error("Login error:", error);

    const serverError = t?.("serverError") ?? "Internal server error";

    if (!shouldIncludeFailureTaxonomy(request)) {
      return withAuthResponseHeaders(NextResponse.json({ error: serverError }, { status: 500 }));
    }

    return withAuthResponseHeaders(
      NextResponse.json({ error: serverError, errorCode: "SERVER_ERROR" }, { status: 500 })
    );
  }
}
