import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RemoteConfigCacheManager } from "../cache-manager";

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "cch-remote-config-cache-"));
}

describe("remote-config/cache-manager", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("persists and loads cached config", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);

    const cache = new RemoteConfigCacheManager({ cacheDir: dir });
    await cache.save("vendors", {
      fetchedAtMs: Date.now(),
      remoteVersion: "2025.12.25",
      text: "dummy = true",
    });

    const loaded = await cache.load("vendors");
    expect(loaded?.remoteVersion).toBe("2025.12.25");
    expect(loaded?.text).toBe("dummy = true");

    const cache2 = new RemoteConfigCacheManager({ cacheDir: dir });
    const loaded2 = await cache2.load("vendors");
    expect(loaded2?.remoteVersion).toBe("2025.12.25");
  });

  test("expires entries when ttlMs is set", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    const cache = new RemoteConfigCacheManager({ cacheDir: dir, ttlMs: 1000 });
    await cache.save("prices-override", {
      fetchedAtMs: Date.now(),
      remoteVersion: "v1",
      text: "dummy = true",
    });

    vi.setSystemTime(new Date("2025-01-01T00:00:02.000Z"));
    const loaded = await cache.load("prices-override");
    expect(loaded).toBeNull();

    vi.useRealTimers();
  });
});
