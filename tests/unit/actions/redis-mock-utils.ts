import { vi } from "vitest";

export function createRedisStore() {
  const store = new Map<string, { value: string; expiresAt: number }>();

  function readValue(key: string): string | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  const setex = vi.fn(async (key: string, ttlSeconds: number, value: string) => {
    store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return "OK";
  });

  const get = vi.fn(async (key: string) => readValue(key));

  const del = vi.fn(async (key: string) => {
    const existed = store.delete(key);
    return existed ? 1 : 0;
  });

  const evalScript = vi.fn(async (_script: string, _numKeys: number, key: string) => {
    const value = readValue(key);
    if (value === null) return null;
    store.delete(key);
    return value;
  });

  return { store, mocks: { setex, get, del, eval: evalScript } };
}

export function buildRedisMock(mocks: ReturnType<typeof createRedisStore>["mocks"]) {
  return {
    getRedisClient: () => ({
      status: "ready",
      setex: mocks.setex,
      get: mocks.get,
      del: mocks.del,
      eval: mocks.eval,
    }),
  };
}
