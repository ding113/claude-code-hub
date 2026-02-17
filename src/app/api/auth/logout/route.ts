import { type NextRequest, NextResponse } from "next/server";
import {
  clearAuthCookie,
  getAuthCookie,
  getSessionTokenMode,
  type SessionTokenMode,
  withNoStoreHeaders,
} from "@/lib/auth";
import { RedisSessionStore } from "@/lib/auth-session-store/redis-session-store";
import { logger } from "@/lib/logger";
import { createCsrfOriginGuard } from "@/lib/security/csrf-origin-guard";

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

export async function POST(request: NextRequest) {
  const csrfResult = csrfGuard.check(request);
  if (!csrfResult.allowed) {
    return withNoStoreHeaders(
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
  return withNoStoreHeaders(NextResponse.json({ ok: true }));
}
