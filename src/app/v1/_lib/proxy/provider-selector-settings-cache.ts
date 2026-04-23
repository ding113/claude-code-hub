import { logger } from "@/lib/logger";
import { getSystemSettings } from "@/repository/system-config";

const SETTINGS_CACHE_TTL_MS = 60_000;

let cachedVerboseProviderError: { value: boolean; expiresAt: number } | null = null;

export function invalidateProviderSelectorSystemSettingsCache(): void {
  cachedVerboseProviderError = null;
}

export async function getVerboseProviderErrorCached(): Promise<boolean> {
  const now = Date.now();
  if (cachedVerboseProviderError && cachedVerboseProviderError.expiresAt > now) {
    return cachedVerboseProviderError.value;
  }

  try {
    const systemSettings = await getSystemSettings();
    cachedVerboseProviderError = {
      value: systemSettings.verboseProviderError,
      expiresAt: now + SETTINGS_CACHE_TTL_MS,
    };
    return systemSettings.verboseProviderError;
  } catch (e) {
    logger.warn(
      "ProviderSelector: Failed to get system settings, using default verboseError=false",
      { error: e }
    );
    return false;
  }
}
