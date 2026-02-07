import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthSessionStorage, ScopedAuthContext } from "@/lib/auth";

if (!globalThis.__cchAuthSessionStorage) {
  globalThis.__cchAuthSessionStorage =
    new AsyncLocalStorage<ScopedAuthContext>() as unknown as AuthSessionStorage;
}

export const authSessionStorage: AuthSessionStorage = globalThis.__cchAuthSessionStorage;
