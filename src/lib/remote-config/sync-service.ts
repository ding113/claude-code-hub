import { logger } from "@/lib/logger";
import type { CachedRemoteConfig, RemoteConfigKey } from "./cache-manager";
import { RemoteConfigCacheManager } from "./cache-manager";
import { parsePricesOverrideToml, parseTomlDocument, parseVendorsToml } from "./toml-parser";

export type RemoteConfigSource = "cdn" | "fallback" | "cache";

export type RemoteConfigSyncResult<T> =
  | {
      ok: true;
      source: RemoteConfigSource;
      remoteVersion: string;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export interface RemoteConfigSyncServiceOptions {
  cacheManager?: RemoteConfigCacheManager;
  cdnBaseUrl?: string;
  fallbackBaseUrl?: string;
  fetcher?: typeof fetch;
}

type ParsedRemoteConfig<T extends RemoteConfigKey> = T extends "vendors"
  ? ReturnType<typeof parseVendorsToml>
  : ReturnType<typeof parsePricesOverrideToml>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractMetadataVersionFromToml(text: string): string {
  const doc = parseTomlDocument(text);
  if (!isRecord(doc)) {
    throw new Error("TOML document must be an object");
  }

  const metadata = doc.metadata;
  if (!isRecord(metadata)) {
    throw new Error("metadata must be an object");
  }

  const version = metadata.version;
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("metadata.version must be a non-empty string");
  }

  return version;
}

export class RemoteConfigSyncService {
  static CDN_URL = process.env.REMOTE_CONFIG_CDN_URL || "https://cdn.claude-code-hub.app/config";
  static FALLBACK_URL =
    process.env.REMOTE_CONFIG_FALLBACK_URL ||
    "https://raw.githubusercontent.com/ding113/claude-code-hub-docs/main/public/config";

  private cacheManager: RemoteConfigCacheManager;
  private cdnBaseUrl: string;
  private fallbackBaseUrl: string;
  private fetcher: typeof fetch;

  constructor(options: RemoteConfigSyncServiceOptions = {}) {
    this.cacheManager = options.cacheManager ?? new RemoteConfigCacheManager();
    this.cdnBaseUrl = options.cdnBaseUrl ?? RemoteConfigSyncService.CDN_URL;
    this.fallbackBaseUrl = options.fallbackBaseUrl ?? RemoteConfigSyncService.FALLBACK_URL;
    this.fetcher = options.fetcher ?? fetch;
  }

  private async fetchText(url: string): Promise<string | null> {
    try {
      const res = await this.fetcher(url, {
        headers: {
          Accept: "text/plain",
        },
      });

      if (!res.ok) {
        return null;
      }

      return await res.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("[RemoteConfig] fetch failed", { url, error: message });
      return null;
    }
  }

  private async fetchRemoteConfigText(configKey: RemoteConfigKey): Promise<{
    source: Exclude<RemoteConfigSource, "cache">;
    text: string;
  } | null> {
    const fileName = configKey === "vendors" ? "vendors.toml" : "prices-override.toml";

    const cdnUrl = `${this.cdnBaseUrl}/${fileName}`;
    const cdnText = await this.fetchText(cdnUrl);
    if (cdnText) return { source: "cdn", text: cdnText };

    const fallbackUrl = `${this.fallbackBaseUrl}/${fileName}`;
    const fallbackText = await this.fetchText(fallbackUrl);
    if (fallbackText) return { source: "fallback", text: fallbackText };

    return null;
  }

  private parseConfig<T extends RemoteConfigKey>(
    configKey: T,
    text: string
  ): ParsedRemoteConfig<T> {
    if (configKey === "vendors") {
      return parseVendorsToml(text) as ParsedRemoteConfig<T>;
    }

    return parsePricesOverrideToml(text) as ParsedRemoteConfig<T>;
  }

  private async loadFromCache(configKey: RemoteConfigKey): Promise<CachedRemoteConfig | null> {
    return await this.cacheManager.load(configKey);
  }

  private async saveToCache(configKey: RemoteConfigKey, entry: CachedRemoteConfig): Promise<void> {
    await this.cacheManager.save(configKey, entry);
  }

  async syncVendors(): Promise<RemoteConfigSyncResult<ReturnType<typeof parseVendorsToml>>> {
    return await this.syncConfig("vendors");
  }

  async syncPrices(): Promise<RemoteConfigSyncResult<ReturnType<typeof parsePricesOverrideToml>>> {
    return await this.syncConfig("prices-override");
  }

  private async syncConfig<T extends RemoteConfigKey>(
    configKey: T
  ): Promise<RemoteConfigSyncResult<ParsedRemoteConfig<T>>> {
    const remote = await this.fetchRemoteConfigText(configKey);

    if (remote) {
      try {
        const remoteVersion = extractMetadataVersionFromToml(remote.text);
        const data = this.parseConfig(configKey, remote.text);

        await this.saveToCache(configKey, {
          fetchedAtMs: Date.now(),
          remoteVersion,
          text: remote.text,
        });

        return { ok: true, source: remote.source, remoteVersion, data };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    }

    const cached = await this.loadFromCache(configKey);
    if (!cached) {
      return { ok: false, error: "Failed to fetch remote config and no cache available" };
    }

    try {
      const remoteVersion = cached.remoteVersion ?? extractMetadataVersionFromToml(cached.text);
      const data = this.parseConfig(configKey, cached.text);
      return { ok: true, source: "cache", remoteVersion, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  async checkForUpdates(): Promise<boolean> {
    const vendorsChanged = await this.hasUpdateFor("vendors");
    if (vendorsChanged) return true;

    const pricesChanged = await this.hasUpdateFor("prices-override");
    return pricesChanged;
  }

  private async hasUpdateFor(configKey: RemoteConfigKey): Promise<boolean> {
    const cached = await this.loadFromCache(configKey);
    const cachedVersion = cached?.remoteVersion ?? null;

    const remote = await this.fetchRemoteConfigText(configKey);
    if (!remote) {
      return false;
    }

    let remoteVersion: string;
    try {
      remoteVersion = extractMetadataVersionFromToml(remote.text);
    } catch {
      return false;
    }

    if (!cachedVersion) {
      return true;
    }

    return remoteVersion !== cachedVersion;
  }
}
