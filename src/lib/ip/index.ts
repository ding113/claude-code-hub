import {
  DEFAULT_IP_EXTRACTION_CONFIG,
  type IpExtractionConfig,
} from "@/types/ip-extraction";
import { extractClientIp, type HeadersLike } from "./extract-client-ip";
import { getCachedSystemSettingsOnlyCache } from "@/lib/config/system-settings-cache";

export { DEFAULT_IP_EXTRACTION_CONFIG } from "@/types/ip-extraction";
export { extractClientIp } from "./extract-client-ip";
export { isPrivateIp } from "./private-ip";

/**
 * Extract a client IP using the currently cached system-settings config.
 *
 * Uses the in-memory cache (no DB read on the hot path); falls back to the
 * built-in default when the cache is cold or misconfigured.
 */
export function getClientIp(
  source: HeadersLike,
  override?: IpExtractionConfig
): string | null {
  if (override) return extractClientIp(source, override);

  const settings = getCachedSystemSettingsOnlyCache();
  const config = settings?.ipExtractionConfig ?? DEFAULT_IP_EXTRACTION_CONFIG;
  return extractClientIp(source, config);
}
