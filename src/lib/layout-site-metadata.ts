import { logger } from "@/lib/logger";

const FALLBACK_SITE_TITLE = "Claude Code Hub";

export async function resolveDefaultSiteMetadataSource(): Promise<{
  siteTitle: string;
  siteDescription: string;
}> {
  try {
    const { getSystemSettings } = await import("@/repository/system-config");
    const settings = await getSystemSettings();
    const title = settings.siteTitle?.trim() || FALLBACK_SITE_TITLE;

    return {
      siteTitle: title,
      siteDescription: title,
    };
  } catch (error) {
    logger.warn("resolveDefaultSiteMetadataSource failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      siteTitle: FALLBACK_SITE_TITLE,
      siteDescription: FALLBACK_SITE_TITLE,
    };
  }
}

export async function resolveDefaultLayoutTimeZone(): Promise<string> {
  try {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone");
    return await resolveSystemTimezone();
  } catch (error) {
    logger.warn("resolveDefaultLayoutTimeZone failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "UTC";
  }
}
