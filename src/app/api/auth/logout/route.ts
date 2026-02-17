import { type NextRequest, NextResponse } from "next/server";
import {
  clearAuthCookie,
  getAuthCookie,
  getSessionTokenMode,
  type SessionTokenMode,
  withNoStoreHeaders,
} from "@/lib/auth";
import { RedisSessionStore } from "@/lib/auth-session-store/redis-session-store";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { createCsrfOriginGuard } from "@/lib/security/csrf-origin-guard";
import { buildSecurityHeaders } from "@/lib/security/security-headers";

const csrfGuard = createCsrfOriginGuard({
  allowedOrigins: [],
  allowSameOrigin: true,
  enforceInDevelopment: process.env.VITEST === "true",
});

function resolveSessionTokenMode(): SessionTokenMode {
  const resolver = getSessionTokenMode as unknown as (() => SessionTokenMode) | undefined;
  return resolver?.() ?? "legacy";
}

async function resolveAuthCookieToken(): Promise<string | undefined> {
  const reader = getAuthCookie as unknown as (() => Promise<string | undefined>) | undefined;
  if (!reader) return undefined;
  return reader();
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  const env = getEnvConfig();
  const headers = buildSecurityHeaders({
    enableHsts: env.ENABLE_SECURE_COOKIES,
    cspMode: "report-only",
  });

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}

function withAuthResponseHeaders(response: NextResponse): NextResponse {
  return applySecurityHeaders(withNoStoreHeaders(response));
}

export async function POST(request: NextRequest) {
  const csrfResult = csrfGuard.check(request);
  if (!csrfResult.allowed) {
    return withAuthResponseHeaders(
      NextResponse.json({ error: "Forbidden", errorCode: "CSRF_REJECTED" }, { status: 403 })
    );
  }

  const mode = resolveSessionTokenMode();

  if (mode !== "legacy") {
    try {
      const sessionId = await resolveAuthCookieToken();
      if (sessionId) {
        const store = new RedisSessionStore();
        await store.revoke(sessionId);
      }
    } catch (error) {
      logger.warn("[AuthLogout] Failed to revoke opaque session during logout", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await clearAuthCookie();
  return withAuthResponseHeaders(NextResponse.json({ ok: true }));
}
