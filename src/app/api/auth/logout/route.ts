import { type NextRequest, NextResponse } from "next/server";
import {
  clearAuthCookie,
  getAuthCookie,
  getSessionTokenMode,
  type SessionTokenMode,
} from "@/lib/auth";
import { RedisSessionStore } from "@/lib/auth-session-store/redis-session-store";
import { logger } from "@/lib/logger";
import { withAuthResponseHeaders } from "@/lib/security/auth-response-headers";
import { createCsrfOriginGuard } from "@/lib/security/csrf-origin-guard";

const csrfGuard = createCsrfOriginGuard({
  allowedOrigins: [],
  allowSameOrigin: true,
  enforceInDevelopment: process.env.VITEST === "true",
});

function resolveSessionTokenMode(): SessionTokenMode {
  try {
    return getSessionTokenMode();
  } catch {
    return "legacy";
  }
}

async function resolveAuthCookieToken(): Promise<string | undefined> {
  try {
    return await getAuthCookie();
  } catch {
    return undefined;
  }
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
