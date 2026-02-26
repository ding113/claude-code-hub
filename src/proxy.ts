import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import type { Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { isDevelopment } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

// Public paths that don't require authentication
// Note: These paths will be automatically prefixed with locale by next-intl middleware
const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];
const DEV_PUBLIC_PATH_PATTERNS = ["/internal/ui-preview"];

const API_PROXY_PATH = "/v1";

// Create next-intl middleware for locale detection and routing
const intlMiddleware = createMiddleware(routing);

function proxyHandler(request: NextRequest) {
  const method = request.method;
  const pathname = request.nextUrl.pathname;

  if (isDevelopment()) {
    logger.info("Request received", { method: method.toUpperCase(), pathname });
  }

  // API 代理路由不需要 locale 处理和 Web 鉴权（使用自己的 Bearer token）
  if (pathname.startsWith(API_PROXY_PATH)) {
    return NextResponse.next();
  }

  // Skip locale handling for static files and Next.js internals
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Apply locale middleware first (handles locale detection and routing)
  const localeResponse = intlMiddleware(request);

  // Extract locale from pathname (format: /[locale]/path or just /path)
  const localeMatch = pathname.match(/^\/([^/]+)/);
  const potentialLocale = localeMatch?.[1];
  const isLocaleInPath = routing.locales.includes(potentialLocale as Locale);

  // Get the pathname without locale prefix
  // When isLocaleInPath is true, potentialLocale is guaranteed to be defined
  const pathWithoutLocale = isLocaleInPath
    ? pathname.slice((potentialLocale?.length ?? 0) + 1)
    : pathname;

  // Check if current path (without locale) is a public path
  const isPublicPath = PUBLIC_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(pattern)
  );
  const isDevPublicPath =
    isDevelopment() &&
    DEV_PUBLIC_PATH_PATTERNS.some(
      (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(pattern)
    );

  // Public paths don't require authentication
  if (isPublicPath || isDevPublicPath) {
    return localeResponse;
  }

  // Check authentication for protected routes (cookie existence only).
  // Full session validation (Redis lookup, key permissions, expiry) is handled
  // by downstream layouts (dashboard/layout.tsx, etc.) which run in Node.js
  // runtime with guaranteed Redis/DB access. This avoids a death loop where
  // the proxy deletes the cookie on transient validation failures.
  const authToken = request.cookies.get(AUTH_COOKIE_NAME);

  if (!authToken) {
    // Not authenticated, redirect to login page
    const url = request.nextUrl.clone();
    // Preserve locale in redirect
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    url.pathname = `/${locale}/login`;
    url.searchParams.set("from", pathWithoutLocale || "/dashboard");
    return NextResponse.redirect(url);
  }

  // Cookie exists - pass through to layout for full validation
  return localeResponse;
}

// Default export required for Next.js 16 proxy file
export default proxyHandler;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes - handled separately)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
