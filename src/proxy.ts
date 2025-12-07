import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import type { Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { validateKey } from "@/lib/auth";
import { isDevelopment } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

// Public paths that don't require authentication
// Note: These paths will be automatically prefixed with locale by next-intl middleware
const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];

// Paths that allow read-only access (for canLoginWebUi=false keys)
// These paths bypass the canLoginWebUi check in validateKey
const READ_ONLY_PATH_PATTERNS = ["/my-usage"];

const API_PROXY_PATH = "/v1";

// Create next-intl middleware for locale detection and routing
const intlMiddleware = createMiddleware(routing);

async function proxyHandler(request: NextRequest) {
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

  // Public paths don't require authentication
  if (isPublicPath) {
    return localeResponse;
  }

  // Check if current path allows read-only access (for canLoginWebUi=false keys)
  const isReadOnlyPath = READ_ONLY_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(`${pattern}/`)
  );

  // Check authentication for protected routes
  const authToken = request.cookies.get("auth-token");

  if (!authToken) {
    // Not authenticated, redirect to login page
    const url = request.nextUrl.clone();
    // Preserve locale in redirect
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    url.pathname = `/${locale}/login`;
    url.searchParams.set("from", pathWithoutLocale || "/dashboard");
    return NextResponse.redirect(url);
  }

  // Validate key permissions (canLoginWebUi, isEnabled, expiresAt, etc.)
  const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
  if (!session) {
    // Invalid key or insufficient permissions, clear cookie and redirect to login
    const url = request.nextUrl.clone();
    // Preserve locale in redirect
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    url.pathname = `/${locale}/login`;
    url.searchParams.set("from", pathWithoutLocale || "/dashboard");
    const response = NextResponse.redirect(url);
    response.cookies.delete("auth-token");
    return response;
  }

  // Authentication passed, return locale response
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
