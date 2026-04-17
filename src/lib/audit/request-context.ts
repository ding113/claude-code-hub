import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

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

export function getRequestContext(): AuditRequestContext {
  return storage.getStore() ?? { ip: null, userAgent: null };
}
