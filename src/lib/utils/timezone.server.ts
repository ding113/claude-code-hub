import "server-only";

import { getEnvConfig } from "@/lib/config/env.schema";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import { isValidIANATimezone } from "./timezone";

/**
 * Resolves the system timezone using the fallback chain:
 *   1. DB system_settings.timezone (via cached settings)
 *   2. env TZ variable
 *   3. "UTC" as final fallback
 *
 * Each candidate is validated via isValidIANATimezone before being accepted.
 *
 * @returns Resolved IANA timezone identifier (always valid)
 */
export async function resolveSystemTimezone(): Promise<string> {
  // Step 1: Try DB timezone from cached system settings
  try {
    const settings = await getCachedSystemSettings();
    if (settings.timezone && isValidIANATimezone(settings.timezone)) {
      return settings.timezone;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read cached system settings", { error });
  }

  // Step 2: Fallback to env TZ
  try {
    const { TZ } = getEnvConfig();
    if (TZ && isValidIANATimezone(TZ)) {
      return TZ;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read env TZ", { error });
  }

  // Step 3: Ultimate fallback
  return "UTC";
}
