import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { getClientIp } from "@/lib/ip";
import { logger } from "@/lib/logger";

export interface AuditRequestContext {
  ip: string | null;
  userAgent: string | null;
}

interface AuditRequestContextStorage {
  run<T>(store: AuditRequestContext, callback: () => T): T;
  getStore(): AuditRequestContext | undefined;
}

declare global {
  // eslint-disable-next-line no-var
  var __cchAuditRequestContextStorage: AuditRequestContextStorage | undefined;
}

if (!globalThis.__cchAuditRequestContextStorage) {
  globalThis.__cchAuditRequestContextStorage =
    new AsyncLocalStorage<AuditRequestContext>() as unknown as AuditRequestContextStorage;
}

const storage = globalThis.__cchAuditRequestContextStorage;

export function runWithRequestContext<T>(ctx: AuditRequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Synchronous ALS-only accessor. Returns nulls when the storage is empty.
 * Prefer `resolveRequestContext()` when you can: it additionally falls back
 * to `next/headers` for direct Next.js Server Actions that bypass the
 * OpenAPI action adapter.
 */
export function getRequestContext(): AuditRequestContext {
  return storage.getStore() ?? { ip: null, userAgent: null };
}

/**
 * Async accessor that prefers the ALS context (populated by the OpenAPI
 * action adapter) and falls back to `next/headers` when called from a
 * plain Next.js Server Action (e.g. the settings form's `startTransition`
 * path). This keeps audit rows from losing operator IP / User-Agent for
 * actions invoked outside the adapter.
 *
 * Never throws — any fallback failure returns nulls.
 */
export async function resolveRequestContext(): Promise<AuditRequestContext> {
  const fromAls = storage.getStore();
  if (fromAls && (fromAls.ip !== null || fromAls.userAgent !== null)) {
    return fromAls;
  }

  try {
    // Dynamic import so this module still loads in non-RSC/test contexts
    // where `next/headers` isn't available.
    const { headers } = await import("next/headers");
    const h = await headers();
    return {
      ip: getClientIp(h),
      userAgent: h.get("user-agent") ?? null,
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      logger.warn("[Audit] next/headers request-context fallback failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return fromAls ?? { ip: null, userAgent: null };
  }
}
