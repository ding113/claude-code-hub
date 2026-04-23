const FALLBACK_SITE_TITLE = "Claude Code Hub";

export async function resolveDefaultSiteMetadataSource(): Promise<{
  siteTitle: string;
  siteDescription: string;
}> {
  const { getSystemSettings } = await import("@/repository/system-config");
  const settings = await getSystemSettings();
  const title = settings.siteTitle?.trim() || FALLBACK_SITE_TITLE;

  return {
    siteTitle: title,
    siteDescription: title,
  };
}

export async function resolveDefaultLayoutTimeZone(): Promise<string> {
  const { resolveSystemTimezone } = await import("@/lib/utils/timezone");
  return await resolveSystemTimezone();
}
