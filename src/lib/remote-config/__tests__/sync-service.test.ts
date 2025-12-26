import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RemoteConfigCacheManager } from "../cache-manager";
import { RemoteConfigSyncService } from "../sync-service";

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "cch-remote-config-sync-"));
}

const VENDORS_TOML_V1 = `
[metadata]
version = "v1"

[[vendors]]
slug = "anthropic"
name = "Anthropic"
category = "official"

[[vendors.endpoints]]
name = "Official API"
url = "https://api.anthropic.com"
api_format = "claude"
`;

const VENDORS_TOML_V2 = VENDORS_TOML_V1.replace('version = "v1"', 'version = "v2"');

describe("remote-config/sync-service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    vi.unstubAllGlobals();
  });

  test("uses CDN first and caches result", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.example/config/vendors.toml") {
        return new Response(VENDORS_TOML_V1, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const cache = new RemoteConfigCacheManager({ cacheDir: dir });
    const service = new RemoteConfigSyncService({
      cacheManager: cache,
      cdnBaseUrl: "https://cdn.example/config",
      fallbackBaseUrl: "https://raw.example/config",
    });

    const res = await service.syncVendors();
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.source).toBe("cdn");
    expect(res.remoteVersion).toBe("v1");

    const cached = await cache.load("vendors");
    expect(cached?.remoteVersion).toBe("v1");
  });

  test("falls back when CDN fails", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.example/config/vendors.toml") {
        return new Response("fail", { status: 500 });
      }
      if (url === "https://raw.example/config/vendors.toml") {
        return new Response(VENDORS_TOML_V1, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const cache = new RemoteConfigCacheManager({ cacheDir: dir });
    const service = new RemoteConfigSyncService({
      cacheManager: cache,
      cdnBaseUrl: "https://cdn.example/config",
      fallbackBaseUrl: "https://raw.example/config",
    });

    const res = await service.syncVendors();
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.source).toBe("fallback");
    expect(res.remoteVersion).toBe("v1");
  });

  test("uses cache when both CDN and fallback fail", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);

    const cache = new RemoteConfigCacheManager({ cacheDir: dir });
    await cache.save("vendors", {
      fetchedAtMs: Date.now(),
      remoteVersion: "v1",
      text: VENDORS_TOML_V1,
    });

    const fetchMock = vi.fn(async () => new Response("fail", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new RemoteConfigSyncService({
      cacheManager: cache,
      cdnBaseUrl: "https://cdn.example/config",
      fallbackBaseUrl: "https://raw.example/config",
    });

    const res = await service.syncVendors();
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.source).toBe("cache");
    expect(res.remoteVersion).toBe("v1");
  });

  test("checkForUpdates compares remote version with cached version", async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);

    const cache = new RemoteConfigCacheManager({ cacheDir: dir });
    await cache.save("vendors", {
      fetchedAtMs: Date.now(),
      remoteVersion: "v1",
      text: VENDORS_TOML_V1,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.example/config/vendors.toml") {
        return new Response(VENDORS_TOML_V2, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new RemoteConfigSyncService({
      cacheManager: cache,
      cdnBaseUrl: "https://cdn.example/config",
      fallbackBaseUrl: "https://raw.example/config",
    });

    expect(await service.checkForUpdates()).toBe(true);
  });
});
