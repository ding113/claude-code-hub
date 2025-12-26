import fs from "node:fs/promises";
import path from "node:path";

export type RemoteConfigKey = "vendors" | "prices-override";

export interface CachedRemoteConfig {
  fetchedAtMs: number;
  remoteVersion: string | null;
  text: string;
}

export interface RemoteConfigCacheManagerOptions {
  cacheDir?: string;
  ttlMs?: number;
}

export class RemoteConfigCacheManager {
  private cacheDir: string;
  private ttlMs: number | null;

  constructor(options: RemoteConfigCacheManagerOptions = {}) {
    this.cacheDir =
      options.cacheDir ?? path.join(process.cwd(), "public", "cache", "remote-config");
    this.ttlMs = typeof options.ttlMs === "number" ? options.ttlMs : null;
  }

  private getCachePath(configKey: RemoteConfigKey): string {
    return path.join(this.cacheDir, `${configKey}.json`);
  }

  async save(configKey: RemoteConfigKey, entry: CachedRemoteConfig): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const cachePath = this.getCachePath(configKey);
    await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), "utf-8");
  }

  async load(configKey: RemoteConfigKey): Promise<CachedRemoteConfig | null> {
    const cachePath = this.getCachePath(configKey);
    try {
      const raw = await fs.readFile(cachePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<CachedRemoteConfig> | null;

      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.text !== "string") return null;
      if (typeof parsed.fetchedAtMs !== "number") return null;
      if (parsed.remoteVersion !== null && typeof parsed.remoteVersion !== "string") return null;

      if (this.ttlMs !== null) {
        const age = Date.now() - parsed.fetchedAtMs;
        if (age > this.ttlMs) {
          return null;
        }
      }

      return {
        fetchedAtMs: parsed.fetchedAtMs,
        remoteVersion: parsed.remoteVersion ?? null,
        text: parsed.text,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return null;
      return null;
    }
  }

  async remove(configKey: RemoteConfigKey): Promise<void> {
    const cachePath = this.getCachePath(configKey);
    await fs.rm(cachePath, { force: true });
  }
}
