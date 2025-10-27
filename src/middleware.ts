import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { isDevelopment } from "@/lib/config/env.schema";
import { validateKey } from "@/lib/auth";

const PUBLIC_PATHS = [
  "/login",
  "/usage-doc",
  "/api/auth/login",
  "/api/auth/logout",
  "/_next",
  "/favicon.ico",
];

const API_PROXY_PATH = "/v1";

export async function middleware(request: NextRequest) {
  const method = request.method;
  const pathname = request.nextUrl.pathname;

  if (isDevelopment()) {
    logger.info("Request received", { method: method.toUpperCase(), pathname });
  }

  // API 代理路由不需要 Web 鉴权（使用自己的 Bearer token）
  if (pathname.startsWith(API_PROXY_PATH)) {
    return NextResponse.next();
  }

  // 公开路径不需要鉴权
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  if (isPublicPath) {
    return NextResponse.next();
  }

  // 检查认证 cookie
  const authToken = request.cookies.get("auth-token");

  if (!authToken) {
    // 未登录，重定向到登录页
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // 验证 key 的完整权限（包括 canLoginWebUi、isEnabled、expiresAt 等）
  const session = await validateKey(authToken.value);
  if (!session) {
    // Key 无效或权限不足，清除 cookie 并重定向到登录页
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    const response = NextResponse.redirect(url);
    response.cookies.delete("auth-token");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
