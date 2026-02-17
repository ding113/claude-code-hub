import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { defaultLocale, type Locale, locales } from "@/i18n/config";
import { getLoginRedirectTarget, setAuthCookie, validateKey } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

// 需要数据库连接
export const runtime = "nodejs";

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

export async function POST(request: NextRequest) {
  const locale = getLocaleFromRequest(request);
  const t = await getAuthErrorTranslations(locale);

  try {
    const { key } = await request.json();

    if (!key) {
      if (!shouldIncludeFailureTaxonomy(request)) {
        return NextResponse.json({ error: t?.("apiKeyRequired") }, { status: 400 });
      }

      return NextResponse.json(
        { error: t?.("apiKeyRequired"), errorCode: "KEY_REQUIRED" },
        { status: 400 }
      );
    }

    const session = await validateKey(key, { allowReadOnlyAccess: true });
    if (!session) {
      if (!shouldIncludeFailureTaxonomy(request)) {
        return NextResponse.json({ error: t?.("apiKeyInvalidOrExpired") }, { status: 401 });
      }

      const responseBody: {
        error: string | undefined;
        errorCode: "KEY_INVALID";
        httpMismatchGuidance?: string;
      } = {
        error: t?.("apiKeyInvalidOrExpired"),
        errorCode: "KEY_INVALID",
      };

      if (hasSecureCookieHttpMismatch(request)) {
        const securityT = await getAuthSecurityTranslations(locale);
        responseBody.httpMismatchGuidance =
          securityT?.("cookieWarningDescription") ??
          t?.("apiKeyInvalidOrExpired") ??
          t?.("serverError");
      }

      return NextResponse.json(responseBody, { status: 401 });
    }

    // 设置认证 cookie
    await setAuthCookie(key);

    const redirectTo = getLoginRedirectTarget(session);

    return NextResponse.json({
      ok: true,
      user: {
        id: session.user.id,
        name: session.user.name,
        description: session.user.description,
        role: session.user.role,
      },
      redirectTo,
    });
  } catch (error) {
    logger.error("Login error:", error);

    if (!shouldIncludeFailureTaxonomy(request)) {
      return NextResponse.json({ error: t?.("serverError") }, { status: 500 });
    }

    return NextResponse.json(
      { error: t?.("serverError"), errorCode: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
