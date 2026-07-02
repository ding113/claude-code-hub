import "server-only";

import { getEnvConfig } from "@/lib/config/env.schema";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import { isValidIANATimezone } from "@/lib/utils/timezone";

/**
 * Resolves the system timezone using the fallback chain:
 *   1. DB system_settings.timezone (via cached settings)
 *   2. env TZ variable
 *   3. "UTC" as final fallback
 */
export async function resolveSystemTimezone(): Promise<string> {
  try {
    const settings = await getCachedSystemSettings();
    if (settings.timezone && isValidIANATimezone(settings.timezone)) {
      return settings.timezone;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read cached system settings", { error });
  }

  try {
    const { TZ } = getEnvConfig();
    if (TZ && isValidIANATimezone(TZ)) {
      return TZ;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read env TZ", { error });
  }

  return "UTC";
}
