import { getSystemSettings } from "@/repository/system-config";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

export type DegradationConfigSource = "database" | "environment" | "default";

export async function resolveCrossGroupDegradation(): Promise<{
  allowed: boolean;
  source: DegradationConfigSource;
}> {
  try {
    const settings = await getSystemSettings();
    if (settings && settings.id > 0) {
      return {
        allowed: settings.allowCrossGroupOnDegrade,
        source: "database",
      };
    }
  } catch (error) {
    logger.warn("ProviderSelector: Failed to load system settings for degradation config", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const envValue = getEnvConfig().ALLOW_CROSS_GROUP_DEGRADE;
  if (envValue !== undefined) {
    return {
      allowed: envValue,
      source: "environment",
    };
  }

  return {
    allowed: false,
    source: "default",
  };
}
