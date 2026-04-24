import {
  getCachedSystemSettings,
  getCachedSystemSettingsOnlyCache,
} from "@/lib/config/system-settings-cache";
import { DEFAULT_IP_EXTRACTION_CONFIG, type IpExtractionConfig } from "@/types/ip-extraction";
import { extractClientIp, type HeadersLike } from "./extract-client-ip";

export { DEFAULT_IP_EXTRACTION_CONFIG } from "@/types/ip-extraction";
export { extractClientIp } from "./extract-client-ip";
export { isPrivateIp } from "./private-ip";

const POTENTIAL_IP_HEADERS = new Set([
  "x-real-ip",
  "x-forwarded-for",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "forwarded",
]);

function hasPotentialIpHeader(source: HeadersLike): boolean {
  if (source instanceof Headers) {
    for (const key of source.keys()) {
      if (POTENTIAL_IP_HEADERS.has(key.toLowerCase())) return true;
    }
    return false;
  }

  return Object.keys(source).some((key) => POTENTIAL_IP_HEADERS.has(key.toLowerCase()));
}

/**
 * Extract a client IP using the currently cached system-settings config.
 *
 * Uses the in-memory cache (no DB read on the hot path); falls back to the
 * built-in default when the cache is cold or misconfigured.
 */
export function getClientIp(source: HeadersLike, override?: IpExtractionConfig): string | null {
  if (override) return extractClientIp(source, override);

  const settings = getCachedSystemSettingsOnlyCache();
  const config = settings?.ipExtractionConfig ?? DEFAULT_IP_EXTRACTION_CONFIG;
  return extractClientIp(source, config);
}

export async function getClientIpWithFreshSettings(
  source: HeadersLike,
  override?: IpExtractionConfig
): Promise<string | null> {
  if (override) return extractClientIp(source, override);

  const cachedSettings = getCachedSystemSettingsOnlyCache();
  if (cachedSettings) {
    return extractClientIp(
      source,
      cachedSettings.ipExtractionConfig ?? DEFAULT_IP_EXTRACTION_CONFIG
    );
  }

  if (!hasPotentialIpHeader(source)) {
    return extractClientIp(source, DEFAULT_IP_EXTRACTION_CONFIG);
  }

  const settings = await getCachedSystemSettings();
  return extractClientIp(source, settings.ipExtractionConfig ?? DEFAULT_IP_EXTRACTION_CONFIG);
}
