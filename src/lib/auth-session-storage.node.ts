import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthSession, AuthSessionStorage } from "@/lib/auth";

declare global {
  // eslint-disable-next-line no-var
  var __cchAuthSessionStorage: AuthSessionStorage | undefined;
}

if (!globalThis.__cchAuthSessionStorage) {
  globalThis.__cchAuthSessionStorage = new AsyncLocalStorage<AuthSession>() as unknown as AuthSessionStorage;
}

