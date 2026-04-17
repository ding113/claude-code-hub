import { isIP } from "node:net";
import { getEnvConfig } from "@/lib/config/env.schema";
import { isPrivateIp } from "@/lib/ip/private-ip";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import type { IpGeoLookupResponse, IpGeoLookupResult } from "@/types/ip-geo";

const CACHE_PREFIX = "ipgeo:v1:";
const NEGATIVE_TTL_SECONDS = 60;

interface CachedOk {
  kind: "ok";
  data: IpGeoLookupResult;
}

interface CachedError {
  kind: "error";
  error: string;
}

type CachedEntry = CachedOk | CachedError;

function cacheKey(ip: string, lang: string): string {
  return `${CACHE_PREFIX}${ip}:${lang}`;
}

async function readCache(key: string): Promise<CachedEntry | null> {
  try {
    const redis = getRedisClient();
    if (!redis) return null;
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedEntry;
  } catch (error) {
    logger.debug("[IpGeo] cache read failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeCache(key: string, entry: CachedEntry, ttlSeconds: number): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.set(key, JSON.stringify(entry), "EX", ttlSeconds);
  } catch (error) {
    logger.debug("[IpGeo] cache write failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function fetchFromUpstream(
  ip: string,
  lang: string
): Promise<IpGeoLookupResult | { error: string }> {
  const env = getEnvConfig();
  const base = env.IP_GEO_API_URL.replace(/\/+$/, "");
  const url = `${base}/v1/ip2location/${encodeURIComponent(ip)}?lang=${encodeURIComponent(lang)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.IP_GEO_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (env.IP_GEO_API_TOKEN) headers.authorization = `Bearer ${env.IP_GEO_API_TOKEN}`;

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { error: `upstream status ${response.status}` };
    }

    const data = (await response.json()) as IpGeoLookupResult;
    if (!data || typeof data !== "object" || !("ip" in data)) {
      return { error: "upstream returned unexpected shape" };
    }
    return data;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface LookupIpOptions {
  lang?: string;
  /** When true, skip the cache entirely (still writes to cache on success). */
  bypassCache?: boolean;
}

/**
 * Resolve geolocation + network metadata for an IP.
 *
 * - Short-circuits private / loopback / link-local IPs without hitting upstream.
 * - Caches both successful and negative results in Redis (negative = 60s, success = configurable).
 * - Never throws; returns `{ status: "error" }` on failure so callers can render a graceful UI.
 */
export async function lookupIp(
  ip: string,
  options: LookupIpOptions = {}
): Promise<IpGeoLookupResponse> {
  const trimmedIp = ip.trim();

  if (!isIP(trimmedIp)) {
    return { status: "error", error: "invalid ip" };
  }

  if (isPrivateIp(trimmedIp)) {
    return { status: "private", data: { ip: trimmedIp, kind: "private" } };
  }

  const env = getEnvConfig();
  const lang = options.lang ?? "en";
  const key = cacheKey(trimmedIp, lang);

  if (!options.bypassCache) {
    const cached = await readCache(key);
    if (cached) {
      return cached.kind === "ok"
        ? { status: "ok", data: cached.data }
        : { status: "error", error: cached.error };
    }
  }

  const upstream = await fetchFromUpstream(trimmedIp, lang);

  if ("error" in upstream) {
    await writeCache(key, { kind: "error", error: upstream.error }, NEGATIVE_TTL_SECONDS);
    return { status: "error", error: upstream.error };
  }

  await writeCache(key, { kind: "ok", data: upstream }, env.IP_GEO_CACHE_TTL_SECONDS);
  return { status: "ok", data: upstream };
}
