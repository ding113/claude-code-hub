import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { defaultLocale, type Locale, locales } from "@/i18n/config";
import { getLoginRedirectTarget, setAuthCookie, validateKey } from "@/lib/auth";
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

export async function POST(request: NextRequest) {
  const locale = getLocaleFromRequest(request);

  try {
    const t = await getTranslations({ locale, namespace: "auth.errors" });
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: t("apiKeyRequired") }, { status: 400 });
    }

    const session = await validateKey(key, { allowReadOnlyAccess: true });
    if (!session) {
      return NextResponse.json({ error: t("apiKeyInvalidOrExpired") }, { status: 401 });
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
    const t = await getTranslations({ locale, namespace: "auth.errors" });
    return NextResponse.json({ error: t("serverError") }, { status: 500 });
  }
}
