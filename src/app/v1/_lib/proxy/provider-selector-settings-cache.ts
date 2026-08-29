import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";

export async function getVerboseProviderErrorCached(): Promise<boolean> {
  try {
    return (await getCachedSystemSettings()).verboseProviderError;
  } catch (error) {
    logger.warn(
      "ProviderSelector: Failed to get system settings, using default verboseError=false",
      { error }
    );
    return false;
  }
}
